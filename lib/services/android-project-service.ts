import * as path from "path";
import * as shell from "shelljs";
import * as constants from "../constants";
import * as semver from "semver";
import * as projectServiceBaseLib from "./platform-project-service-base";
import { DeviceAndroidDebugBridge } from "../common/mobile/android/device-android-debug-bridge";
import { attachAwaitDetach } from "../common/helpers";
import { Configurations, LiveSyncPaths } from "../common/constants";
import { SpawnOptions } from "child_process";
import { performanceLog } from ".././common/decorators";

export class AndroidProjectService extends projectServiceBaseLib.PlatformProjectServiceBase implements IPlatformProjectService {
	private static VALUES_DIRNAME = "values";
	private static VALUES_VERSION_DIRNAME_PREFIX = AndroidProjectService.VALUES_DIRNAME + "-v";
	private static ANDROID_PLATFORM_NAME = "android";
	private static MIN_RUNTIME_VERSION_WITH_GRADLE = "1.5.0";

	private isAndroidStudioTemplate: boolean;

	constructor(private $androidToolsInfo: IAndroidToolsInfo,
		private $childProcess: IChildProcess,
		private $errors: IErrors,
		$fs: IFileSystem,
		private $hostInfo: IHostInfo,
		private $logger: ILogger,
		$projectDataService: IProjectDataService,
		private $injector: IInjector,
		private $devicePlatformsConstants: Mobile.IDevicePlatformsConstants,
		private $androidPluginBuildService: IAndroidPluginBuildService,
		private $platformEnvironmentRequirements: IPlatformEnvironmentRequirements,
		private $androidResourcesMigrationService: IAndroidResourcesMigrationService,
		private $filesHashService: IFilesHashService) {
		super($fs, $projectDataService);
		this.isAndroidStudioTemplate = false;
	}

	private _platformData: IPlatformData = null;
	public getPlatformData(projectData: IProjectData): IPlatformData {
		if (!projectData && !this._platformData) {
			throw new Error("First call of getPlatformData without providing projectData.");
		}
		if (projectData && projectData.platformsDir) {
			const projectRoot = path.join(projectData.platformsDir, AndroidProjectService.ANDROID_PLATFORM_NAME);
			if (this.isAndroidStudioCompatibleTemplate(projectData)) {
				this.isAndroidStudioTemplate = true;
			}

			const appDestinationDirectoryArr = [projectRoot];
			if (this.isAndroidStudioTemplate) {
				appDestinationDirectoryArr.push(constants.APP_FOLDER_NAME);
			}
			appDestinationDirectoryArr.push(constants.SRC_DIR, constants.MAIN_DIR, constants.ASSETS_DIR);

			const configurationsDirectoryArr = [projectRoot];
			if (this.isAndroidStudioTemplate) {
				configurationsDirectoryArr.push(constants.APP_FOLDER_NAME);
			}
			configurationsDirectoryArr.push(constants.SRC_DIR, constants.MAIN_DIR, constants.MANIFEST_FILE_NAME);

			const deviceBuildOutputArr = [projectRoot];
			if (this.isAndroidStudioTemplate) {
				deviceBuildOutputArr.push(constants.APP_FOLDER_NAME);
			}
			deviceBuildOutputArr.push(constants.BUILD_DIR, constants.OUTPUTS_DIR, constants.APK_DIR);

			const packageName = this.getProjectNameFromId(projectData);

			this._platformData = {
				frameworkPackageName: constants.TNS_ANDROID_RUNTIME_NAME,
				normalizedPlatformName: "Android",
				appDestinationDirectoryPath: path.join(...appDestinationDirectoryArr),
				platformProjectService: this,
				projectRoot: projectRoot,
				getBuildOutputPath: () =>  path.join(...deviceBuildOutputArr),
				bundleBuildOutputPath: path.join(projectRoot, constants.APP_FOLDER_NAME, constants.BUILD_DIR, constants.OUTPUTS_DIR, constants.BUNDLE_DIR),
				getValidBuildOutputData: (buildOptions: IBuildOutputOptions): IValidBuildOutputData => {
					const buildMode = buildOptions.release ? Configurations.Release.toLowerCase() : Configurations.Debug.toLowerCase();

					if (buildOptions.androidBundle) {
						return {
							packageNames: [
								`${constants.APP_FOLDER_NAME}${constants.AAB_EXTENSION_NAME}`
							]
						};
					}

					return {
						packageNames: [
							`${packageName}-${buildMode}${constants.APK_EXTENSION_NAME}`,
							`${projectData.projectName}-${buildMode}${constants.APK_EXTENSION_NAME}`,
							`${projectData.projectName}${constants.APK_EXTENSION_NAME}`,
							`${constants.APP_FOLDER_NAME}-${buildMode}${constants.APK_EXTENSION_NAME}`

						],
						regexes: [new RegExp(`${constants.APP_FOLDER_NAME}-.*-(${Configurations.Debug}|${Configurations.Release})${constants.APK_EXTENSION_NAME}`, "i"), new RegExp(`${packageName}-.*-(${Configurations.Debug}|${Configurations.Release})${constants.APK_EXTENSION_NAME}`, "i")]
					};
				},
				frameworkFilesExtensions: [".jar", ".dat", ".so"],
				configurationFileName: constants.MANIFEST_FILE_NAME,
				configurationFilePath: path.join(...configurationsDirectoryArr),
				relativeToFrameworkConfigurationFilePath: path.join(constants.SRC_DIR, constants.MAIN_DIR, constants.MANIFEST_FILE_NAME),
				fastLivesyncFileExtensions: [".jpg", ".gif", ".png", ".bmp", ".webp"] // http://developer.android.com/guide/appendix/media-formats.html
			};

		}

		return this._platformData;
	}

	public getCurrentPlatformVersion(platformData: IPlatformData, projectData: IProjectData): string {
		const currentPlatformData: IDictionary<any> = this.$projectDataService.getNSValue(projectData.projectDir, platformData.frameworkPackageName);

		return currentPlatformData && currentPlatformData[constants.VERSION_STRING];
	}

	public async validateOptions(): Promise<boolean> {
		return true;
	}

	public getAppResourcesDestinationDirectoryPath(projectData: IProjectData): string {
		const appResourcesDirStructureHasMigrated = this.$androidResourcesMigrationService.hasMigrated(projectData.getAppResourcesDirectoryPath());

		if (appResourcesDirStructureHasMigrated) {
			return this.getUpdatedAppResourcesDestinationDirPath(projectData);
		} else {
			return this.getLegacyAppResourcesDestinationDirPath(projectData);
		}
	}

	public async validate(projectData: IProjectData, options: IOptions, notConfiguredEnvOptions?: INotConfiguredEnvOptions): Promise<IValidatePlatformOutput> {
		this.validatePackageName(projectData.projectIdentifiers.android);
		this.validateProjectName(projectData.projectName);

		const checkEnvironmentRequirementsOutput = await this.$platformEnvironmentRequirements.checkEnvironmentRequirements({
			platform: this.getPlatformData(projectData).normalizedPlatformName,
			projectDir: projectData.projectDir,
			options,
			notConfiguredEnvOptions
		});

		this.$androidToolsInfo.validateTargetSdk({ showWarningsAsErrors: true });

		return {
			checkEnvironmentRequirementsOutput
		};
	}

	public async validatePlugins(): Promise<void> { /* */ }

	public async createProject(frameworkDir: string, frameworkVersion: string, projectData: IProjectData, config: ICreateProjectOptions): Promise<void> {
		if (semver.lt(frameworkVersion, AndroidProjectService.MIN_RUNTIME_VERSION_WITH_GRADLE)) {
			this.$errors.failWithoutHelp(`The NativeScript CLI requires Android runtime ${AndroidProjectService.MIN_RUNTIME_VERSION_WITH_GRADLE} or later to work properly.`);
		}

		this.$fs.ensureDirectoryExists(this.getPlatformData(projectData).projectRoot);
		const androidToolsInfo = this.$androidToolsInfo.getToolsInfo();
		const targetSdkVersion = androidToolsInfo && androidToolsInfo.targetSdkVersion;
		this.$logger.trace(`Using Android SDK '${targetSdkVersion}'.`);

		this.isAndroidStudioTemplate = this.isAndroidStudioCompatibleTemplate(projectData, frameworkVersion);
		if (this.isAndroidStudioTemplate) {
			this.copy(this.getPlatformData(projectData).projectRoot, frameworkDir, "*", "-R");
		} else {
			this.copy(this.getPlatformData(projectData).projectRoot, frameworkDir, "libs", "-R");

			if (config.pathToTemplate) {
				const mainPath = path.join(this.getPlatformData(projectData).projectRoot, constants.SRC_DIR, constants.MAIN_DIR);
				this.$fs.createDirectory(mainPath);
				shell.cp("-R", path.join(path.resolve(config.pathToTemplate), "*"), mainPath);
			} else {
				this.copy(this.getPlatformData(projectData).projectRoot, frameworkDir, constants.SRC_DIR, "-R");
			}
			this.copy(this.getPlatformData(projectData).projectRoot, frameworkDir, "build.gradle settings.gradle build-tools", "-Rf");

			try {
				this.copy(this.getPlatformData(projectData).projectRoot, frameworkDir, "gradle.properties", "-Rf");
			} catch (e) {
				this.$logger.warn(`\n${e}\nIt's possible, the final .apk file will contain all architectures instead of the ones described in the abiFilters!\nYou can fix this by using the latest android platform.`);
			}

			this.copy(this.getPlatformData(projectData).projectRoot, frameworkDir, "gradle", "-R");
			this.copy(this.getPlatformData(projectData).projectRoot, frameworkDir, "gradlew gradlew.bat", "-f");
		}

		this.cleanResValues(targetSdkVersion, projectData);
	}

	private cleanResValues(targetSdkVersion: number, projectData: IProjectData): void {
		const resDestinationDir = this.getAppResourcesDestinationDirectoryPath(projectData);
		const directoriesInResFolder = this.$fs.readDirectory(resDestinationDir);
		const directoriesToClean = directoriesInResFolder
			.map(dir => {
				return {
					dirName: dir,
					sdkNum: parseInt(dir.substr(AndroidProjectService.VALUES_VERSION_DIRNAME_PREFIX.length))
				};
			})
			.filter(dir => dir.dirName.match(AndroidProjectService.VALUES_VERSION_DIRNAME_PREFIX)
				&& dir.sdkNum
				&& (!targetSdkVersion || (targetSdkVersion < dir.sdkNum)))
			.map(dir => path.join(resDestinationDir, dir.dirName));

		this.$logger.trace("Directories to clean:");

		this.$logger.trace(directoriesToClean);

		_.map(directoriesToClean, dir => this.$fs.deleteDirectory(dir));
	}

	public async interpolateData(projectData: IProjectData, platformSpecificData: IPlatformSpecificData): Promise<void> {
		// Interpolate the apilevel and package
		this.interpolateConfigurationFile(projectData, platformSpecificData);
		const appResourcesDirectoryPath = projectData.getAppResourcesDirectoryPath();

		let stringsFilePath: string;

		const appResourcesDestinationDirectoryPath = this.getAppResourcesDestinationDirectoryPath(projectData);
		if (this.$androidResourcesMigrationService.hasMigrated(appResourcesDirectoryPath)) {
			stringsFilePath = path.join(appResourcesDestinationDirectoryPath, constants.MAIN_DIR, constants.RESOURCES_DIR, 'values', 'strings.xml');
		} else {
			stringsFilePath = path.join(appResourcesDestinationDirectoryPath, 'values', 'strings.xml');
		}

		shell.sed('-i', /__NAME__/, projectData.projectName, stringsFilePath);
		shell.sed('-i', /__TITLE_ACTIVITY__/, projectData.projectName, stringsFilePath);

		const gradleSettingsFilePath = path.join(this.getPlatformData(projectData).projectRoot, "settings.gradle");
		shell.sed('-i', /__PROJECT_NAME__/, this.getProjectNameFromId(projectData), gradleSettingsFilePath);

		try {
			// will replace applicationId in app/App_Resources/Android/app.gradle if it has not been edited by the user
			const appGradleContent = this.$fs.readText(projectData.appGradlePath);
			if (appGradleContent.indexOf(constants.PACKAGE_PLACEHOLDER_NAME) !== -1) {
				//TODO: For compatibility with old templates. Once all templates are updated should delete.
				shell.sed('-i', new RegExp(constants.PACKAGE_PLACEHOLDER_NAME), projectData.projectIdentifiers.android, projectData.appGradlePath);
			}
		} catch (e) {
			this.$logger.trace(`Templates updated and no need for replace in app.gradle.`);
		}
	}

	public interpolateConfigurationFile(projectData: IProjectData, platformSpecificData: IPlatformSpecificData): void {
		const manifestPath = this.getPlatformData(projectData).configurationFilePath;
		shell.sed('-i', /__PACKAGE__/, projectData.projectIdentifiers.android, manifestPath);
		if (this.$androidToolsInfo.getToolsInfo().androidHomeEnvVar) {
			const sdk = (platformSpecificData && platformSpecificData.sdk) || (this.$androidToolsInfo.getToolsInfo().compileSdkVersion || "").toString();
			shell.sed('-i', /__APILEVEL__/, sdk, manifestPath);
		}
	}

	private getProjectNameFromId(projectData: IProjectData): string {
		let id: string;
		if (projectData && projectData.projectIdentifiers && projectData.projectIdentifiers.android) {
			const idParts = projectData.projectIdentifiers.android.split(".");
			id = idParts[idParts.length - 1];
		}

		return id;
	}

	public afterCreateProject(projectRoot: string): void {
		return null;
	}

	public canUpdatePlatform(newInstalledModuleDir: string, projectData: IProjectData): boolean {
		return true;
	}

	public async updatePlatform(currentVersion: string, newVersion: string, canUpdate: boolean, projectData: IProjectData, addPlatform?: Function, removePlatforms?: (platforms: string[]) => Promise<void>): Promise<boolean> {
		if (semver.eq(newVersion, AndroidProjectService.MIN_RUNTIME_VERSION_WITH_GRADLE)) {
			const platformLowercase = this.getPlatformData(projectData).normalizedPlatformName.toLowerCase();
			await removePlatforms([platformLowercase.split("@")[0]]);
			await addPlatform(platformLowercase);
			return false;
		}

		return true;
	}

	@performanceLog()
	public async buildProject(projectRoot: string, projectData: IProjectData, buildConfig: IBuildConfig): Promise<void> {
		let task;
		const gradleArgs = this.getGradleBuildOptions(buildConfig, projectData);
		const baseTask = buildConfig.androidBundle ? "bundle" : "assemble";
		const platformData = this.getPlatformData(projectData);
		const outputPath = buildConfig.androidBundle ? platformData.bundleBuildOutputPath : platformData.getBuildOutputPath(buildConfig);
		if (this.$logger.getLevel() === "TRACE") {
			gradleArgs.unshift("--stacktrace");
			gradleArgs.unshift("--debug");
		}
		if (buildConfig.release) {
			task = `${baseTask}Release`;
		} else {
			task = `${baseTask}Debug`;
		}

		gradleArgs.unshift(task);

		const handler = (data: any) => {
			this.emit(constants.BUILD_OUTPUT_EVENT_NAME, data);
		};

		await attachAwaitDetach(constants.BUILD_OUTPUT_EVENT_NAME,
			this.$childProcess,
			handler,
			this.executeCommand({
				projectRoot: this.getPlatformData(projectData).projectRoot,
				gradleArgs,
				childProcessOpts: { stdio: buildConfig.buildOutputStdio || "inherit" },
				spawnFromEventOptions: { emitOptions: { eventName: constants.BUILD_OUTPUT_EVENT_NAME }, throwError: true },
				message: "Gradle build..."
			})
		);

		await this.$filesHashService.saveHashesForProject(this._platformData, outputPath);
	}

	private getGradleBuildOptions(settings: IAndroidBuildOptionsSettings, projectData: IProjectData): Array<string> {
		const configurationFilePath = this.getPlatformData(projectData).configurationFilePath;

		const buildOptions: Array<string> = this.getBuildOptions(configurationFilePath);

		if (settings.release) {
			buildOptions.push("-Prelease");
			buildOptions.push(`-PksPath=${path.resolve(settings.keyStorePath)}`);
			buildOptions.push(`-Palias=${settings.keyStoreAlias}`);
			buildOptions.push(`-Ppassword=${settings.keyStoreAliasPassword}`);
			buildOptions.push(`-PksPassword=${settings.keyStorePassword}`);
		}

		return buildOptions;
	}

	private getBuildOptions(configurationFilePath?: string): Array<string> {
		this.$androidToolsInfo.validateInfo({ showWarningsAsErrors: true, validateTargetSdk: true });

		const androidToolsInfo = this.$androidToolsInfo.getToolsInfo();
		const compileSdk = androidToolsInfo.compileSdkVersion;
		const targetSdk = this.getTargetFromAndroidManifest(configurationFilePath) || compileSdk;
		const buildToolsVersion = androidToolsInfo.buildToolsVersion;
		const generateTypings = androidToolsInfo.generateTypings;
		const buildOptions = [
			`-PcompileSdk=android-${compileSdk}`,
			`-PtargetSdk=${targetSdk}`,
			`-PbuildToolsVersion=${buildToolsVersion}`,
			`-PgenerateTypings=${generateTypings}`
		];

		return buildOptions;
	}

	public async buildForDeploy(projectRoot: string, projectData: IProjectData, buildConfig?: IBuildConfig): Promise<void> {
		return this.buildProject(projectRoot, projectData, buildConfig);
	}

	public isPlatformPrepared(projectRoot: string, projectData: IProjectData): boolean {
		return this.$fs.exists(path.join(this.getPlatformData(projectData).appDestinationDirectoryPath, constants.APP_FOLDER_NAME));
	}

	public getFrameworkFilesExtensions(): string[] {
		return [".jar", ".dat"];
	}

	public async prepareProject(): Promise<void> {
		// Intentionally left empty.
	}

	public ensureConfigurationFileInAppResources(projectData: IProjectData): void {
		const appResourcesDirectoryPath = projectData.appResourcesDirectoryPath;
		const appResourcesDirStructureHasMigrated = this.$androidResourcesMigrationService.hasMigrated(appResourcesDirectoryPath);
		let originalAndroidManifestFilePath;

		if (appResourcesDirStructureHasMigrated) {
			originalAndroidManifestFilePath = path.join(appResourcesDirectoryPath, this.$devicePlatformsConstants.Android, "src", "main", this.getPlatformData(projectData).configurationFileName);
		} else {
			originalAndroidManifestFilePath = path.join(appResourcesDirectoryPath, this.$devicePlatformsConstants.Android, this.getPlatformData(projectData).configurationFileName);
		}

		const manifestExists = this.$fs.exists(originalAndroidManifestFilePath);

		if (!manifestExists) {
			this.$logger.warn('No manifest found in ' + originalAndroidManifestFilePath);
			return;
		}
		// Overwrite the AndroidManifest from runtime.
		if (!appResourcesDirStructureHasMigrated) {
			this.$fs.copyFile(originalAndroidManifestFilePath, this.getPlatformData(projectData).configurationFilePath);
		}
	}

	public prepareAppResources(appResourcesDirectoryPath: string, projectData: IProjectData): void {
		this.cleanUpPreparedResources(appResourcesDirectoryPath, projectData);
	}

	public async preparePluginNativeCode(pluginData: IPluginData, projectData: IProjectData): Promise<void> {
		// build Android plugins which contain AndroidManifest.xml and/or resources
		const pluginPlatformsFolderPath = this.getPluginPlatformsFolderPath(pluginData, AndroidProjectService.ANDROID_PLATFORM_NAME);
		if (this.$fs.exists(pluginPlatformsFolderPath)) {
			const options: IPluginBuildOptions = {
				projectDir: projectData.projectDir,
				pluginName: pluginData.name,
				platformsAndroidDirPath: pluginPlatformsFolderPath,
				aarOutputDir: pluginPlatformsFolderPath,
				tempPluginDirPath: path.join(projectData.platformsDir, "tempPlugin")
			};

			if (await this.$androidPluginBuildService.buildAar(options)) {
				this.$logger.info(`Built aar for ${options.pluginName}`);
			}

			this.$androidPluginBuildService.migrateIncludeGradle(options);
		}
	}

	public async processConfigurationFilesFromAppResources(): Promise<void> {
		return;
	}

	public async removePluginNativeCode(pluginData: IPluginData, projectData: IProjectData): Promise<void> {
		// not implemented
	}

	public async beforePrepareAllPlugins(projectData: IProjectData, dependencies?: IDependencyData[]): Promise<void> {
		if (dependencies) {
			dependencies = this.filterUniqueDependencies(dependencies);
			this.provideDependenciesJson(projectData, dependencies);
		}
	}

	public async handleNativeDependenciesChange(projectData: IProjectData, opts: IRelease): Promise<void> {
		return;
	}

	private filterUniqueDependencies(dependencies: IDependencyData[]): IDependencyData[] {
		const depsDictionary = dependencies.reduce((dict, dep) => {
			const collision = dict[dep.name];
			// in case there are multiple dependencies to the same module, the one declared in the package.json takes precedence
			if (!collision || collision.depth > dep.depth) {
				dict[dep.name] = dep;
			}
			return dict;
		}, <IDictionary<IDependencyData>>{});
		return _.values(depsDictionary);
	}

	private provideDependenciesJson(projectData: IProjectData, dependencies: IDependencyData[]): void {
		const platformDir = path.join(projectData.platformsDir, AndroidProjectService.ANDROID_PLATFORM_NAME);
		const dependenciesJsonPath = path.join(platformDir, constants.DEPENDENCIES_JSON_NAME);
		const nativeDependencies = dependencies
			.filter(AndroidProjectService.isNativeAndroidDependency)
			.map(({ name, directory }) => ({ name, directory: path.relative(platformDir, directory) }));
		const jsonContent = JSON.stringify(nativeDependencies, null, 4);

		this.$fs.writeFile(dependenciesJsonPath, jsonContent);
	}

	private static isNativeAndroidDependency({ nativescript }: IDependencyData): boolean {
		return nativescript && (nativescript.android || (nativescript.platforms && nativescript.platforms.android));
	}

	public stopServices(projectRoot: string): Promise<ISpawnResult> {
		return this.executeCommand({
			projectRoot,
			gradleArgs: ["--stop", "--quiet"],
			childProcessOpts: { stdio: "pipe" },
			message: "Gradle stop services..."
		});
	}

	public async cleanProject(projectRoot: string, projectData: IProjectData): Promise<void> {
		if (this.$androidToolsInfo.getToolsInfo().androidHomeEnvVar) {
			const gradleArgs = this.getGradleBuildOptions({ release: false }, projectData);
			gradleArgs.unshift("clean");
			await this.executeCommand({
				projectRoot,
				gradleArgs,
				message: "Gradle clean..."
			});
		}
	}

	public async cleanDeviceTempFolder(deviceIdentifier: string, projectData: IProjectData): Promise<void> {
		const adb = this.$injector.resolve(DeviceAndroidDebugBridge, { identifier: deviceIdentifier });
		const deviceRootPath = `${LiveSyncPaths.ANDROID_TMP_DIR_NAME}/${projectData.projectIdentifiers.android}`;
		await adb.executeShellCommand(["rm", "-rf", deviceRootPath]);
	}

	public async checkForChanges(changesInfo: IProjectChangesInfo, options: IProjectChangesOptions, projectData: IProjectData): Promise<void> {
		// Nothing android specific to check yet.
	}

	public getDeploymentTarget(projectData: IProjectData): semver.SemVer { return; }

	private copy(projectRoot: string, frameworkDir: string, files: string, cpArg: string): void {
		const paths = files.split(' ').map(p => path.join(frameworkDir, p));
		shell.cp(cpArg, paths, projectRoot);
	}

	private async spawn(command: string, args: string[], opts?: any, spawnOpts?: ISpawnFromEventOptions): Promise<ISpawnResult> {
		return this.$childProcess.spawnFromEvent(command, args, "close", opts || { stdio: "inherit" }, spawnOpts);
	}

	private validatePackageName(packageName: string): void {
		//Make the package conform to Java package types
		//Enforce underscore limitation
		if (!/^[a-zA-Z]+(\.[a-zA-Z0-9][a-zA-Z0-9_]*)+$/.test(packageName)) {
			this.$errors.fail("Package name must look like: com.company.Name");
		}

		//Class is a reserved word
		if (/\b[Cc]lass\b/.test(packageName)) {
			this.$errors.fail("class is a reserved word");
		}
	}

	private validateProjectName(projectName: string): void {
		if (projectName === '') {
			this.$errors.fail("Project name cannot be empty");
		}

		//Classes in Java don't begin with numbers
		if (/^[0-9]/.test(projectName)) {
			this.$errors.fail("Project name must not begin with a number");
		}
	}

	private getTargetFromAndroidManifest(configurationFilePath: string): string {
		let versionInManifest: string;
		if (this.$fs.exists(configurationFilePath)) {
			const targetFromAndroidManifest: string = this.$fs.readText(configurationFilePath);
			if (targetFromAndroidManifest) {
				const match = targetFromAndroidManifest.match(/.*?android:targetSdkVersion=\"(.*?)\"/);
				if (match && match[1]) {
					versionInManifest = match[1];
				}
			}
		}

		return versionInManifest;
	}

	private async executeCommand(opts: { projectRoot: string, gradleArgs: any, childProcessOpts?: SpawnOptions, spawnFromEventOptions?: ISpawnFromEventOptions, message: string }): Promise<ISpawnResult> {
		if (this.$androidToolsInfo.getToolsInfo().androidHomeEnvVar) {
			const { projectRoot, gradleArgs, message, spawnFromEventOptions } = opts;
			const gradlew = this.$hostInfo.isWindows ? "gradlew.bat" : "./gradlew";

			if (this.$logger.getLevel() === "INFO") {
				gradleArgs.push("--quiet");
			}

			this.$logger.info(message);

			const childProcessOpts = opts.childProcessOpts || {};
			childProcessOpts.cwd = childProcessOpts.cwd || projectRoot;
			childProcessOpts.stdio = childProcessOpts.stdio || "inherit";
			let commandResult;
			try {
				commandResult = await this.spawn(gradlew,
					gradleArgs,
					childProcessOpts,
					spawnFromEventOptions);
			} catch (err) {
				this.$errors.failWithoutHelp(err.message);
			}

			return commandResult;
		}
	}

	private isAndroidStudioCompatibleTemplate(projectData: IProjectData, frameworkVersion?: string): boolean {
		const currentPlatformData: IDictionary<any> = this.$projectDataService.getNSValue(projectData.projectDir, constants.TNS_ANDROID_RUNTIME_NAME);
		const platformVersion = (currentPlatformData && currentPlatformData[constants.VERSION_STRING]) || frameworkVersion;

		if (!platformVersion) {
			return true;
		}

		if (platformVersion === constants.PackageVersion.NEXT || platformVersion === constants.PackageVersion.LATEST || platformVersion === constants.PackageVersion.RC) {
			return true;
		}

		const androidStudioCompatibleTemplate = "3.4.0";
		const normalizedPlatformVersion = `${semver.major(platformVersion)}.${semver.minor(platformVersion)}.0`;

		return semver.gte(normalizedPlatformVersion, androidStudioCompatibleTemplate);
	}

	private getLegacyAppResourcesDestinationDirPath(projectData: IProjectData): string {
		const resourcePath: string[] = [constants.SRC_DIR, constants.MAIN_DIR, constants.RESOURCES_DIR];
		if (this.isAndroidStudioTemplate) {
			resourcePath.unshift(constants.APP_FOLDER_NAME);
		}

		return path.join(this.getPlatformData(projectData).projectRoot, ...resourcePath);
	}

	private getUpdatedAppResourcesDestinationDirPath(projectData: IProjectData): string {
		const resourcePath: string[] = [constants.SRC_DIR];
		if (this.isAndroidStudioTemplate) {
			resourcePath.unshift(constants.APP_FOLDER_NAME);
		}

		return path.join(this.getPlatformData(projectData).projectRoot, ...resourcePath);
	}

	private cleanUpPreparedResources(appResourcesDirectoryPath: string, projectData: IProjectData): void {
		let resourcesDirPath = path.join(appResourcesDirectoryPath, this.getPlatformData(projectData).normalizedPlatformName);
		if (this.$androidResourcesMigrationService.hasMigrated(projectData.appResourcesDirectoryPath)) {
			resourcesDirPath = path.join(resourcesDirPath, constants.MAIN_DIR, constants.RESOURCES_DIR);
		}

		const valuesDirRegExp = /^values/;
		if (this.$fs.exists(resourcesDirPath)) {
			const resourcesDirs = this.$fs.readDirectory(resourcesDirPath).filter(resDir => !resDir.match(valuesDirRegExp));
			const appResourcesDestinationDirectoryPath = this.getAppResourcesDestinationDirectoryPath(projectData);
			_.each(resourcesDirs, resourceDir => {
				this.$fs.deleteDirectory(path.join(appResourcesDestinationDirectoryPath, resourceDir));
			});
		}
	}
}

$injector.register("androidProjectService", AndroidProjectService);

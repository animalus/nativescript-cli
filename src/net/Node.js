(function() {

  // Utilities.
  var https = require('https');
  var url = require('url');

  // Define the Kinvey.Net.Node network adapter.
  Kinvey.Net.Node = Kinvey.Net.Http.extend({
    /**
     * Creates a new Node network adapter.
     * 
     * @name Kinvey.Net.Node
     * @constructor
     * @extends Kinvey.Net.Http
     * @param {string} api One of Kinvey.Net API constants.
     * @param {string} [collection] Collection name. Required when using the
     *          AppData API.
     * @param {string} [id] Entity id.
     * @throws {Error}
     *           <ul>
     *           <li>On invalid api,</li>
     *           <li>On undefined collection.</li>
     *           </ul>
     */
    constructor: function(api, collection, id) {
      Kinvey.Net.Http.prototype.constructor.call(this, api, collection, id);
    },

    /** @lends Kinvey.Net.Node# */

    /**
     * Returns device information.
     * 
     * @private
     * @return {string} Device information
     */
    _getDeviceInfo: function() {
      // Example: "linux node v0.6.13 0".
      return [
        process.platform,
        process.title,
        process.version,
        0// always set device ID to 0.
      ].map(function(value) {
        return value.toString().toLowerCase().replace(' ', '_');
      }).join(' ');
    },

    /**
     * @override
     * @private
     * @see Kinvey.Net.Http#_process
     */
    _process: function(options) {
      // Split URL in parts.
      var parts = url.parse(this._getUrl());

      // Build body.
      var data = this.data ? JSON.stringify(this.data) : '';

      // Build headers.
      var headers = this.headers();
      headers['X-Kinvey-Device-Information'] = this._getDeviceInfo();
      headers['Content-Length'] = data.length;

      // Build request.
      var self = this;
      var request = https.request({
        host: parts.host,
        path: parts.path,
        method: this.METHOD[this.operation],
        headers: headers,
        auth: this._getAuth()
      }, function(response) {
        // Capture data stream.
        var body = '';
        response.on('data', function(data) {
          body += data;
        });

        // Handle response when it completes.
        response.on('end', function() {
          self._handleResponse(response.statusCode, body, options);
        });
      });
      request.on('error', function(error) {// failed to fire request.
        options.error({ error: error.code });
      });
      data && request.write(data);// pass body.
      request.end();// fire request.
    }
  });

}());
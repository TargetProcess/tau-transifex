var config = require('./config');
var api = require('./index')(config);
api.updateResourceFile({
    "none": {"deep nested message": "deep nested message", "test1": "test1"},
    "custom_js_scope": {"custom js scope": "custom js scope"},
    "remove": {"remove": "remove"}
});


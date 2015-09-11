var request = require('request');
var _ = require('lodash');
var apiUrl = '/api/2/';
var host = 'https://transifex.com';
/**
 *
 * @param {{login:String, password:String, projectSlug: String, resourceSlug: String}} config
 * @return {{getTranslatedResources: Function, updateResourceFile: Function}}
 */
var transifex = function (config) {
    var makeRequest = function (url, method, data) {
        method = method || 'GET';
        // console.log(method + ' ', apiUrl + url);
        var options = {
            url: `${host}${apiUrl}${url}`,
            method: method,
            auth: {
                'user': config.login,
                'pass': config.password
            },
            json: true
        };
        if (method === 'PUT') {
            options.json = data;
        }
        return new Promise(function (resolve, reject) {
            request(options, function (err, response, body) {
                if (!err && response.statusCode == 200) {
                    resolve(body);
                } else {
                    reject(err || body);
                }
            });
        });
    };

    var getResponse = function (url) {
        return makeRequest(url);
    };
    var getLanguages = function () {
        var url = `project/${config.projectSlug}/?details`;
        return getResponse(url).then(function (data) {
            return data.teams;
        });
    };
    var resourceFile = `${config.projectSlug}/resource/${config.resourceSlug}/`;
    var getTranslation = function (langCode) {
        var url = `project/${resourceFile}translation/${langCode}/?mode=reviewed`;
        return getResponse(url).then(function (data) {
            langCode = langCode.replace('_', '-');
            return {lang: langCode, content: data.content};
        });
    };
    var getTranslatedResources = function () {
        return getLanguages().then(function (languages) {
            var resources = languages.map(getTranslation);
            return Promise.all(resources)
        })
    };

    var generateHash = function (key) {
        var crypto = require('crypto');
        var shasum = crypto.createHash('md5');
        var escaped = key.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
        shasum.update(escaped + ":");
        return shasum.digest('hex');
    };

    var getResourceStrings = function (strings) {
        return Promise.all(_.map(strings, function (value, token) {
            var url = `project/${resourceFile}source/${generateHash(token)}`;
            return getResponse(url).then(function (string) {
                string.token = token;
                return string;
            })
        }));
    };

    var putResourceStrings = function (strings) {
        return Promise.all(_.map(strings, function (value) {
            var url = `project/${resourceFile}source/${generateHash(value.token)}`;
            return makeRequest(url, 'PUT', _.omit(value, 'token'))
        }));
    };

    var updateResourceFile = function (dictionaries) {
        var url = `project/${resourceFile}content/`;
        return getResponse(url).then(function (res) {
            var contentFromResource = JSON.parse(res.content);
            return _.merge(contentFromResource, _.extend.apply(_, _.values(dictionaries)));
        }).then(function (content) {
            return Promise.all([makeRequest(url, 'PUT', {content: JSON.stringify(content)}), content]);
        }).then(function (res) {
            return getResourceStrings(res[1]);
        }).then(function (strings) {
            return _.map(strings, function (string) {
                var token = string.token;
                var tag = '';
                _.each(dictionaries, function (dictionary, scope) {
                    tag = '';
                    if (scope !== 'default' && dictionary[token]) {
                        tag = scope;
                    }
                });
                string.tags = _.chain((string.tags || []).concat(tag)).compact().uniq().value();
                return string;
            })
        }).then(function (strings) {
            return putResourceStrings(strings);
        });
    };

    var getLanguagesInfo = function () {
        var url = `languages/`;
        return getResponse(url).then(function (languages) {
            return languages.map(function (lang) {
                lang.code = lang.code.replace('_', '-');
                return lang;
            });
        })
    };

    return {
        getTranslatedResources: getTranslatedResources,
        updateResourceFile: updateResourceFile,
        getLanguagesInfo: getLanguagesInfo
    };
};

module.exports = transifex;

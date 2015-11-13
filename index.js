var request = require('request');
var _ = require('lodash');
var apiUrl = '/api/2/';
var host = 'https://transifex.com';
var Promise = require('bluebird');
var utils = require('./lib/utils');
var generateHash = utils.generateHash;
var mergeStrings = utils.mergeStrings;
var applyTagsToStrings = utils.applyTagsToStrings;
/**
 *
 * @param {{login:String, password:String, projectSlug: String, resourceSlug: String, skipTags: Array[String], obsoleteTag:String, requestConcurrency: Number, stringWillRemove:{tags:Array[String]}}} config
 * @return {{getTranslatedResources: Function, updateResourceFile: Function}}
 */
var transifex = function (config) {
    var concurrency = config.requestConcurrency || 5;
    config.stringWillRemove = config.stringWillRemove || {tags: []};
    config.obsoleteTag = config.obsoleteTag || 'obsolete';
    var resourceFile = `${config.projectSlug}/resource/${config.resourceSlug}/`;

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
    var getResourceStrings = function (strings) {
        return Promise.map(_.toArray(strings), function (token) {
            var url = `project/${resourceFile}source/${generateHash(token)}`;
            return getResponse(url).then(function (string) {
                string.token = token;
                return string;
            });
        }, {concurrency: concurrency});
    };
    var putResourceStrings = function (strings) {
        return Promise.map(strings, function (value) {
            var url = `project/${resourceFile}source/${generateHash(value.token)}`;
            return makeRequest(url, 'PUT', _.omit(value, 'token'))
        }, {concurrency: concurrency}).then(function () {
            return strings;
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

    var removeStringsWithCertainTags = function (strings, tags) {
        var content = utils.removeStringsWithCertainTags(strings, tags);
        var url = `project/${resourceFile}content/`;
        return makeRequest(url, 'PUT', {content: JSON.stringify(content)})
    };


    var updateResourceFile = function (dictionaries) {
        var url = `project/${resourceFile}content/`;
        return getResponse(url).then(function (res) {
            var contentFromResource = JSON.parse(res.content);
            return mergeStrings(dictionaries, contentFromResource);
        }).then(function (strings) {
            return Promise.all([makeRequest(url, 'PUT', {content: JSON.stringify(strings.updateStrings)}), strings]);
        }).then(function (res) {
            return Promise.all([getResourceStrings(res[1].updateStrings), res[1].obsoleteStrings]);
        }).then(function (res) {
            return applyTagsToStrings(dictionaries,res[0], res[1], config)
        }).then(function (strings) {
            return putResourceStrings(strings);
        }).then(function (strings) {
            return removeStringsWithCertainTags(strings, config.stringWillRemove.tags)
        });
    };

    return {
        getTranslatedResources: getTranslatedResources,
        updateResourceFile: updateResourceFile,
        getLanguagesInfo: getLanguagesInfo
    };
};

module.exports = transifex;

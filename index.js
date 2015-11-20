var request = require('request');
var _ = require('lodash');
var apiUrl = 'https://transifex.com/api/2/';
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
        var options = {
            url: `${apiUrl}${url}`,
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

    var getProjectLanguageCodes = function (projectSlug) {
        var url = `project/${projectSlug}/languages`;
        return getResponse(url).then(function (data) {
            return _.pluck(data, 'language_code');
        });
    };

    var getProjectLanguageDetails = function (projectSlug, languageCode) {
        return getResponse(`project/${projectSlug}/language/${languageCode}?details`);
    };

    var getTranslation = function (langCode) {
        var url = `project/${resourceFile}translation/${langCode}/?mode=reviewed`;
        return getResponse(url).then(function (data) {
            return data.content;
        });
    };

    var getTranslatedResources = function () {
        var projectSlug = config.projectSlug;
        return getProjectLanguageCodes(projectSlug)
            .then(function (languageCodes) {
                return Promise.all(languageCodes.map(function (languageCode) {
                    return Promise
                        .all([
                            getProjectLanguageDetails(projectSlug, languageCode),
                            getTranslation(languageCode)
                        ])
                        .then(function (results) {
                            var projectLanguageDetails = results[0];
                            var translation = results[1];
                            return {
                                lang: languageCode.replace('_', '-'),
                                content: translation,
                                stats: {
                                    totalTokensCount: projectLanguageDetails['total_segments'],
                                    translatedTokensCount: projectLanguageDetails['translated_segments'],
                                    reviewedTokensCount: projectLanguageDetails['reviewed_segments'],
                                    translatedWordsCount: projectLanguageDetails['translated_words']
                                }
                            };
                        })
                }));
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
                return {
                    code: lang.code.replace('_', '-'),
                    name: lang.name
                };
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
            return applyTagsToStrings(dictionaries, res[0], res[1], config)
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

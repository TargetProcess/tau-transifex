var request = require('request');
var _ = require('lodash');
var apiUrl = 'https://www.transifex.com/api/2/';
var Promise = require('bluebird');
var utils = require('./lib/utils');
var generateHash = utils.generateHash;
var mergeStrings = utils.mergeStrings;
var applyTagsToStrings = utils.applyTagsToStrings;

var transifexLanguageCodeToIso = function(languageCode) {
    return languageCode.replace('_', '-');
};
var isoLanguageCodeToTransifex = function(languageCode) {
    return languageCode.replace('-', '_');
};

/**
 * @param {{login:String, password:String, projectSlug: String, resourceSlug: String, skipTags: Array[String], obsoleteTag:String, requestConcurrency: Number, stringWillRemove:{tags:Array[String]}}} config
 * @return {{getProjectLanguages,getTranslatedResource,getTranslationStats,getTranslatedResources,getLanguagesInfo}}
 */
var transifex = function (config) {
    var concurrency = config.requestConcurrency || 5;
    config.stringWillRemove = config.stringWillRemove || {tags: []};
    config.obsoleteTag = config.obsoleteTag || 'obsolete';
    config.logLevel = config.logLevel || 'debug';
    var resourceFile = `${config.projectSlug}/resource/${config.resourceSlug}/`;

    var log = function (level, message) {
        console.log("%s %s: %s", level, new Date(), message);
    };

    var logDebug = function (message) {
        if (config.logLevel === 'debug') {
            log(config.logLevel, message);
        }
    };

    var logError = function (message) {
        if (config.logLevel === 'debug' || config.logLevel === 'error') {
            log(config.logLevel, message);
        }
    };

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
                    var reason = err || body || response;

                    logError(reason);

                    reject(reason);
                }
            });
        });
    };

    var getResponse = function (url) {
        return makeRequest(url);
    };

    var getProjectLanguages = function () {
        var url = `project/${config.projectSlug}/languages`;
        return getResponse(url).then(function (data) {
            return data.map(function(item) {
                return {code: transifexLanguageCodeToIso(item['language_code'])};
            });
        });
    };

    var getTranslatedResource = function (isoLanguageCode) {
        var url = `project/${resourceFile}translation/${isoLanguageCodeToTransifex(isoLanguageCode)}/?mode=reviewed`;
        return getResponse(url).then(function (data) {
            return data.content;
        });
    };

    var getTranslatedResources = function () {
        return getProjectLanguages()
            .then(function (languages) {
                return Promise.all(languages.map(function (language) {
                    return getTranslatedResource(language.code)
                        .then(function (content) {
                            return {
                                lang: language.code,
                                content: content
                            };
                        })
                }));
            })
    };

    var getTranslationStats = function (isoLanguageCode) {
        return getResponse(`project/${config.projectSlug}/language/${isoLanguageCodeToTransifex(isoLanguageCode)}?details`)
            .then(function (details) {
                return {
                    totalTokensCount: details['total_segments'],
                    translatedTokensCount: details['translated_segments'],
                    reviewedTokensCount: details['reviewed_segments'],
                    translatedWordsCount: details['translated_words']
                };
            });
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
                    code: transifexLanguageCodeToIso(lang.code),
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
        logDebug('Get Transifex dictionaries content');
        return getResponse(url).then(function (res) {
            logDebug('Merge Transifex and our dictionaries content');
            var contentFromResource = JSON.parse(res.content);
            return mergeStrings(dictionaries, contentFromResource);
        }).then(function (strings) {
            logDebug('Put merged dictionaries to Transifex');
            return Promise.all([makeRequest(url, 'PUT', {content: JSON.stringify(strings.updateStrings)}), strings]);
        }).then(function (res) {
            logDebug('Get dictionaries including obsolete ones from Transifex');
            return Promise.all([getResourceStrings(res[1].updateStrings), res[1].obsoleteStrings]);
        }).then(function (res) {
            logDebug('Apply tags to result dictionaries');
            return applyTagsToStrings(dictionaries, res[0], res[1], config)
        }).then(function (strings) {
            logDebug('Put result dictionaries to Transifex');
            return putResourceStrings(strings);
        }).then(function (strings) {
            logDebug('Remove dictionaries with certain tags');
            return removeStringsWithCertainTags(strings, config.stringWillRemove.tags)
        });
    };

    return {
        getProjectLanguages: getProjectLanguages,
        getTranslationStats: getTranslationStats,
        getTranslatedResource: getTranslatedResource,
        getTranslatedResources: getTranslatedResources,
        updateResourceFile: updateResourceFile,
        getLanguagesInfo: getLanguagesInfo
    };
};

module.exports = transifex;

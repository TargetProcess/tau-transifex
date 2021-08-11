const request = require('request');
const _ = require('lodash');
const Promise = require('bluebird');
const utils = require('./lib/utils');

const generateHash = utils.generateHash;
const mergeStrings = utils.mergeStrings;
const applyTagsToStrings = utils.applyTagsToStrings;
const apiUrl = 'https://www.transifex.com/api/2/';

const transifexLanguageCodeToIso = (languageCode) => languageCode.replace('_', '-');
const isoLanguageCodeToTransifex = (languageCode) => languageCode.replace('-', '_');

const logW = (level, message) => console.log("%s %s: %s", level, new Date(), message);

/**
 * @param {{login:String, password:String, projectSlug: String, resourceSlug: String, skipTags: Array[String], obsoleteTag:String, requestConcurrency: Number, stringWillRemove:{tags:Array[String]}}} config
 * @return {{getProjectLanguages,getTranslatedResource,getTranslationStats,getTranslatedResources,getLanguagesInfo}}
 */
const transifex = function (config) {
    const concurrency = config.requestConcurrency || 5;
    config.stringWillRemove = config.stringWillRemove || {tags: []};
    config.obsoleteTag = config.obsoleteTag || 'obsolete';
    config.logLevel = config.logLevel || 'error';
    const resourceFile = `${config.projectSlug}/resource/${config.resourceSlug}/`;

    if (config.logLevel === 'trace') {
        // Generates a lot of messages.
        request.debug = true;
    }

    const log = {
        debug: (message) => {
            if (config.logLevel === 'trace' || config.logLevel === 'debug') {
                logW(config.logLevel, message);
            }
            return message;
        },
        error: (message) => {
            if (config.logLevel === 'trace' || config.logLevel === 'debug' || config.logLevel === 'error') {
                logW(config.logLevel, message);
            }
            return message;
        }
    };

    const getRequestOptions = (url, method, data) => {
        method = method || 'GET';
        const options = {
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
        return options;
    };

    const makeRequestCall = (options, resolve, reject) => {
        return request(options, (err, response, body) => {
            if (!err && response.statusCode === 200) {
                resolve(body);
            } else {
                const reason = err || body || response;

                // Api rate limits reached.  See https://docs.transifex.com/api/introduction#api-rate-limits
                if (response.statusCode === 429) {
                    const secondsToWaitBeforeRetry = (response.headers['retry-after'] || 5 * 60) + 5;

                    log.error(`${options.url} - API rate limits reached: '${reason}' (429).  Waiting ${secondsToWaitBeforeRetry}s to retry.`);

                    Promise
                        .delay(secondsToWaitBeforeRetry * 1000)
                        .then(() => makeRequestCall(options, resolve, reject));
                } else {
                    reject(log.error(reason));
                }
            }
        });
    };

    const makeRequest = (url, method, data) => {
        const options = getRequestOptions(url, method, data);
        return new Promise((resolve, reject) => makeRequestCall(options, resolve, reject));
    };

    const getResponse = (url) => makeRequest(url);

    const getProjectLanguages = () => {
        const url = `project/${config.projectSlug}/languages`;
        return getResponse(url).then((data) => {
            return data.map((item) => {
                return {code: transifexLanguageCodeToIso(item['language_code'])};
            });
        });
    };

    const getTranslatedResource = (isoLanguageCode) => {
        const url = `project/${resourceFile}translation/${isoLanguageCodeToTransifex(isoLanguageCode)}/?mode=reviewed`;
        return getResponse(url).then((data) => data.content);
    };

    const getTranslatedResources = () => {
        return getProjectLanguages()
            .then((languages) => {
                return Promise.all(languages.map((language) => {
                    return getTranslatedResource(language.code)
                        .then((content) => {
                            return {
                                lang: language.code,
                                content: content
                            };
                        })
                }));
            })
    };

    const getTranslationStats = (isoLanguageCode) => {
        return getResponse(`project/${config.projectSlug}/language/${isoLanguageCodeToTransifex(isoLanguageCode)}?details`)
            .then((details) => {
                return {
                    totalTokensCount: details['total_segments'],
                    translatedTokensCount: details['translated_segments'],
                    reviewedTokensCount: details['reviewed_segments'],
                    translatedWordsCount: details['translated_words']
                };
            });
    };

    const getResourceStrings = (strings) => {
        return Promise
            .map(_.toArray(strings), (token) => {
                const url = `project/${resourceFile}source/${generateHash(token)}`;
                return getResponse(url).then((string) => {
                    string.token = token;
                    return string;
                });
            }, {concurrency: concurrency});
    };

    const putResourceStrings = (strings) => {
        return Promise
            .map(strings, (value) => {
                const url = `project/${resourceFile}source/${generateHash(value.token)}`;
                return makeRequest(url, 'PUT', _.omit(value, 'token'))
            }, {concurrency: concurrency})
            .then(() => strings);
    };

    const getLanguagesInfo = () => {
        const url = `languages/`;
        return getResponse(url).then((languages) => {
            return languages.map((lang) => {
                return {
                    code: transifexLanguageCodeToIso(lang.code),
                    name: lang.name
                };
            });
        })
    };

    const removeStringsWithCertainTags = (strings, tags) => {
        const content = utils.removeStringsWithCertainTags(strings, tags);
        const url = `project/${resourceFile}content/`;
        return makeRequest(url, 'PUT', {content: JSON.stringify(content)})
    };

    const updateResourceFile = (dictionaries) => {
        const url = `project/${resourceFile}content/`;
        log.debug('Get Transifex dictionaries content');
        return getResponse(url).then((res) => {
            log.debug('Merge Transifex and our dictionaries content');
            const contentFromResource = JSON.parse(res.content);
            return mergeStrings(dictionaries, contentFromResource);
        }).then((strings) => {
            log.debug('Put merged dictionaries to Transifex');
            return Promise.all([makeRequest(url, 'PUT', {content: JSON.stringify(strings.updateStrings)}), strings]);
        }).then((res) => {
            log.debug('Get dictionaries including obsolete ones from Transifex');
            return Promise.all([getResourceStrings(res[1].updateStrings), res[1].obsoleteStrings]);
        }).then((res) => {
            log.debug('Apply tags to result dictionaries');
            return applyTagsToStrings(dictionaries, res[0], res[1], config)
        }).then((strings) => {
            log.debug('Put result dictionaries to Transifex');
            return putResourceStrings(strings);
        }).then((strings) => {
            log.debug('Remove dictionaries with certain tags');
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

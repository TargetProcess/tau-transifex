var _ = require('lodash');
module.exports = {
    mergeStrings: function (newStrings, fromTransifex) {
        var flattenStrings = _.defaults.apply(_, [{}].concat(_.values(newStrings)));
        var updateStrings = _.merge({}, fromTransifex, flattenStrings);
        var obsoleteStrings = _.difference(_.values(fromTransifex), _.values(flattenStrings));
        return {
            updateStrings: updateStrings,
            obsoleteStrings: obsoleteStrings
        };
    },
    generateHash: function (key) {
        var crypto = require('crypto');
        var shasum = crypto.createHash('md5');
        var escaped = key.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
        shasum.update(escaped + ":", 'utf8');
        return shasum.digest('hex');
    },
    applyTagsToStrings: function (newStings, stringsWithTags, obsoleteStrings, config) {
        var obsoleteTag = config.obsoleteTag;
        var strings = _.map(_.compact(stringsWithTags), function (string) {
            var token = string.token;
            _.each(newStings, function (dictionary, scope) {
                var tags = [];
                if (dictionary[token]) {
                    tags = _.chain((string.tags || []).concat(scope)).compact().uniq().value();
                    tags = _.without(tags, obsoleteTag);
                    tags =_.uniq(tags);
                    string.tags = _.difference(tags, config.skipTags);
                } else {
                    if(_.includes(obsoleteStrings, token)) {
                        tags = _.chain((string.tags || [])).compact().uniq().value();
                        tags.push(obsoleteTag);
                        tags =_.uniq(tags);
                        string.tags = _.difference(tags, config.skipTags);
                    }
                }
            });
            return string;
        });
        return strings;
    },
    removeStringsWithCertainTags: function (strings, tags) {
        var content = _.reduce(strings, function (content, item) {
            if (_.includes.apply(_, [item.tags || []].concat(tags))) {
                return content;
            }
            content[item.token] = item.token;
            return content;
        }, {});
        return content;
    }
};
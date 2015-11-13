var utils = require('../lib/utils');
var test = require('tape');
var newStings = require('./fixtures/newStrings');
var transifexStrings = require('./fixtures/transifexStrings');
var stringsWithTags =
    [
        {
            "comment": "",
            "character_limit": null,
            "tags": [
                "none"
            ],
            "token": "deep nested message"
        },
        {
            "comment": "",
            "character_limit": null,
            "tags": [
                "none"
            ],
            "token": "test1"
        },
        {
            "comment": "",
            "character_limit": null,
            "tags": null,
            "token": "test"
        },
        {
            "comment": "",
            "character_limit": null,
            "tags": ['test'],
            "token": "test2"
        },
        {
            "comment": "",
            "character_limit": null,
            "tags": [
                "custom_js_scope"
            ],
            "token": "custom js scope"
        },
        {
            "comment": "",
            "character_limit": null,
            "tags": [
                "remove"
            ],
            "token": "remove"
        }

    ];

test('generate hash', function (assert) {
    assert.equal(
        utils.generateHash('Possible transitions are: {currentStateName} → {nextStateNames}.'),
        '43861bf525d30cbbce0c9d0950615645'
    );
    assert.equal(
        utils.generateHash('Possible \\'),
        'c3b342eb9097ddcb0f9d2ef0a312be0c'
    );
    assert.end();
});

test('merge strings', function (assert) {
    assert.deepEqual(
        utils.mergeStrings(newStings, transifexStrings),
        {
            obsoleteStrings: ['test'],
            updateStrings: {
                'custom js scope': 'custom js scope',
                'deep nested message': 'deep nested message',
                remove: 'remove',
                test: 'test',
                test1: 'test1'
            }
        }
    );
    assert.end();
});

test('apply tags', function (assert) {
    assert.deepEquals(
        utils.applyTagsToStrings(newStings, stringsWithTags, ['test', 'test2'], {
            obsoleteTag: 'obsolete',
            skipTags: ['remove']
        }),
        require('./fixtures/expectedTags')
    );
    assert.end();
});

test('remove strings with tags', function (assert) {
    assert.deepEquals(
        utils.removeStringsWithCertainTags(stringsWithTags, ['none']),
        {'custom js scope': 'custom js scope', remove: 'remove', test: 'test', test2: 'test2'}
    );
    assert.end();
});

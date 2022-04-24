_ = lodash;

var NULL = 'NULL',
    escapeMetaCharacters = function (string) {
        string = string.replace(/\$/g, '\\uff04').replace(/\./g, '\\uff0E');
        //NOTE: this method is a workaround for mongo not allowing certain characters in the keys
        //however, the method replaces all the characters in both keys and values. This causes the
        //issue that float values will be escaped, making the json string invalid and parse fails.
        //As a workaround for the workaround I unescape the float values in the string with a regex
        //I could not find an easy way to escape only the keys... :(
        return string.replace(/(":\d+)\\uff0E(\d+)/g, '$1.$2')
    },
    unescapeMetaCharacters = function (string) {
        return string.replace(/\uff04/g, '$').replace(/\uff0E/g, '.');
    },
    Interactions = new Mongo.Collection('interactions', {
        transform: function (doc) {
            //workaround for dots in the keys (problem with mongo)
            doc.interaction = JSON.parse(unescapeMetaCharacters(JSON.stringify(doc.interaction)));
            return doc;
        }
    });

// This function is used to convert json paths that have dashes and cannot be used by jsonpath.query
// For example, it converts $.headers.content-type to $.headers["content-type"]
function escapeDashesInJsonPath(path) {
    var splitted = path.split(".");
    escapedPath = "";
    for (var i=0; i<splitted.length; i++) {
        var key = splitted[i];
        if (key.indexOf("-") === -1) {
            if (i > 0) {
                escapedPath += ".";
            }
            escapedPath += key;
        } else {
            escapedPath += '["' + key + '"]';
        }
    }
    return escapedPath;
}

// The convertAllMatchers* functions are used to convert ruby style matchers present in the
// incoming interactions to jsonpath style matchers

function convertAllMatchersInArray(array, matchingRules, path) {
    for (var i=0; i<array.length; i++) {
        var item = array[i];
        if (Array.isArray(item)) {
            convertAllMatchersInArray(item, matchingRules, path + '[' + i + ']');
        } else if (typeof item === 'object') {
            array[i] = convertAllMatchersInObj(item, matchingRules, path + '[' + i + ']');
        }
    }
}

function convertAllMatchers(rootObject, matchingRules, path) {
    if (path === undefined) {
        path = '$';
    }

    if (matchingRules === undefined) {
        console.log('WARN: matchingRules should not be undefined');
        matchingRules = {};
    }
    if (typeof rootObject === 'object') {
        if (Array.isArray(rootObject)) {
            convertAllMatchersInArray(rootObject, matchingRules, path);
        } else if (rootObject.json_class === 'Pact::Term' || rootObject.json_class === 'Pact::SomethingLike' || rootObject.json_class === 'Pact::ArrayLike') {
            rootObject = convertAllMatchersInObj(rootObject, matchingRules, path);
        } else {
            for (var key in rootObject) {
                if (rootObject.hasOwnProperty(key)) {
                    var value = rootObject[key];
                    if (Array.isArray(value)) {
                        convertAllMatchersInArray(value, matchingRules, path + '.' + key);
                    }
                    else if (value && typeof value === 'object') {
                        if (value.json_class === 'Pact::Term') {
                            if (value.data && value.data.matcher && value.data.matcher.json_class === 'Regexp') {
                                var regex = value.data.matcher.s;
                                rootObject[key] = value.data.generate;
                                matchingRules[path + '.' + key] = {'regex': regex};
                            }
                        }
                        else if (value.json_class === 'Pact::SomethingLike') {
                            rootObject[key] = value.contents;
                            matchingRules[path + '.' + key] = {'match': 'type'};
                        }
                        else if (value.json_class === 'Pact::ArrayLike') {
                            matchingRules[path + '.' + key] = {'min': value.min};
                            var itemsCount = value.min;
                            var item = value.contents;
                            if (!item || typeof item !== 'object') {
                                matchingRules[path + '.' + key + '[*]'] = {'match': 'type'};
                            } else {
                                if (item.json_class === 'Pact::Term' || item.json_class === 'Pact::SomethingLike' || item.json_class === 'Pact::ArrayLike') {
                                    item = convertAllMatchersInObj(item, matchingRules, path + '[*]');
                                }
                                for (var prop in item) {
                                    if (item.hasOwnProperty(prop)) {
                                        var childItem = item[prop];
                                        if (childItem && typeof childItem === 'object') {
                                            item[prop] = convertAllMatchersInObj(childItem, matchingRules, path + '.' + key + '[*].' + prop);
                                        }
                                    }
                                }
                            }
                            rootObject[key] = [];
                            for (var i=0; i<itemsCount; i++) {
                                rootObject[key].push(item);
                            }
                        }
                        else {
                            convertAllMatchers(value, matchingRules, path + '.' + key);
                        }
                    }
                }
            }
        }
    }
    return rootObject;
}


function convertAllMatchersInObj(value, matchingRules, path) {
    var convertedValue = value;
    if (value && typeof value === 'object') {
        if (value.json_class === 'Pact::Term') {
            if (value.data && value.data.matcher && value.data.matcher.json_class === 'Regexp') {
                var regex = value.data.matcher.s;
                convertedValue = value.data.generate;
                matchingRules[path] = {'regex': regex};
            }
        }
        else if (value.json_class === 'Pact::SomethingLike') {
            convertedValue = value.contents;
            matchingRules[path] = {'match': 'type'};
        }
        else if (value.json_class === 'Pact::ArrayLike') {
            matchingRules[path] = {'min': value.min};
            var itemsCount = value.min;
            var item = value.contents;
            if (!item || typeof item !== 'object') {
                matchingRules[path + '[*]'] = {'match': 'type'};
            } else {
                if (item.json_class === 'Pact::Term' || item.json_class === 'Pact::SomethingLike' || item.json_class === 'Pact::ArrayLike') {
                    item = convertAllMatchersInObj(item, matchingRules, path + '[*]');
                }
                for (var prop in item) {
                    if (item.hasOwnProperty(prop)) {
                        var childItem = item[prop];
                        if (childItem && typeof childItem === 'object') {
                            item[prop] = convertAllMatchersInObj(childItem, matchingRules, path + '[*].' + prop);
                        }
                    }
                }
            }
            convertedValue = [];
            for (var i=0; i<itemsCount; i++) {
                convertedValue.push(item);
            }
        }
        else {
            convertedValue = convertAllMatchers(value, matchingRules, path);
        }
    }
    return convertedValue;
}



Meteor.startup(function () {
    // code to run on server at startup
    console.log('meaty-or is alive')
    return;
});

var pathNpm = Npm.require('path'),
    jsonpath = Meteor.npmRequire('jsonpath'),
    querystring = Npm.require('querystring')
    appRoot = pathNpm.resolve('.');
// find better way
appRoot = appRoot.indexOf('.meteor') >= 0 ? appRoot.substring(0, appRoot.indexOf('.meteor')) : appRoot;
console.log(appRoot, 'get the app route')

var fs = Npm.require('fs'),
    normalizeConsumerProvider = function (req) {
        req.headers['x-pact-consumer'] = req.headers['x-pact-consumer'] || NULL;
        req.headers['x-pact-provider'] = req.headers['x-pact-provider'] || NULL;
        console.log('normalizeConsumerProvider',req)

    },
    deleteInteractions = function (req) {
        var consumerName = req.headers['x-pact-consumer'],
            providerName = req.headers['x-pact-provider'];

        Interactions.remove({
            $or: [{ consumer: consumerName }, { provider: providerName }, { expected: 0 }]
        });
        console.log('deleteInteractions',req,consumerName,providerName)

    },
    insertInteraction = function (consumerName, providerName, interaction, expected, count) {
        console.log('insertInteraction start ',consumerName, providerName, interaction, expected, count)
        //workaround for dots in the keys (problem with mongo)
        interaction = JSON.parse(escapeMetaCharacters(JSON.stringify(interaction)));
        Interactions.insert({
            consumer: consumerName,
            provider: providerName,
            expected: expected,
            count: count,
            disabled: false,
            interaction: interaction
        });

        console.log('insertInteraction end',interaction)

    },
    findInteraction = function (interaction, successCallback, errorCallback, selector, useMatchers) {
        var method = interaction.method,
            path = interaction.path,
            query = interaction.query || {},
            headers = interaction.headers || {},
            body = interaction.body || {},
            mergedSelector = _.defaults(selector || {}, {
                expected: { $gt: 0 },
                'interaction.request.method': method.toLowerCase(),
                disabled: false
            }),
            selectedInteraction,
            interactionDiffs = [],
            innerErr,
            bodyMatcher,
            pathMatcher,
            pattern;

        // if query was saved as object, and we need to match it with regex, encode it as string
        var queryForRegexComparison = query;
        if (typeof queryForRegexComparison === "object") {
            queryForRegexComparison = querystring.encode(queryForRegexComparison);
        }

        _.each(Interactions.find(mergedSelector).fetch(), function (matchingInteraction) {
            innerErr = [];
            // compare path of actual and expected, considering matching rules
            pathMatcher = _.get(matchingInteraction.interaction.request.requestMatchingRules, '$.path');
            if (useMatchers && pathMatcher && pathMatcher.regex) {
                pattern = new RegExp(pathMatcher.regex);
                if (!pattern.test(path)) {
                    return;
                }
            } else if (matchingInteraction.interaction.request.path !== path) {
                return;
            }

            // compare query of actual and expected, considering matching rules
            // TODO: Implement query comparison when query is an object and matchers could be used
            // on each query parameter (query object property)
            if (process.env.CHECK_QUERIES !== "false") {
                queryMatcher = _.get(matchingInteraction.interaction.request.requestMatchingRules, '$.query');
                if (useMatchers && queryMatcher && queryMatcher.regex) {
                    pattern = new RegExp(queryMatcher.regex);
                    if (!pattern.test(queryForRegexComparison)) {
                        return
                    }
                } else if (!_.isEqual(matchingInteraction.interaction.request.query || {}, query || {})) {
                    return
                }
            }

            // compare headers of actual and expected
            // iterate thru expected headers to make sure it's in the actual header
            _.each(matchingInteraction.interaction.request.headers, function (value, key) {
                var actualHdr = headers[key], // when comparing headers defined in the pact interaction
                    actualHdrLower = headers[String(key).toLowerCase()], // when comparing with actual HTTP headers
                    hdrMatcher = _.get(matchingInteraction.interaction.request.requestMatchingRules, '$.headers.' + key);
                if (useMatchers && hdrMatcher) {
                    if (hdrMatcher.regex) {
                        pattern = new RegExp(hdrMatcher.regex);
                        if ((!actualHdr || !pattern.test(actualHdr)) && (!actualHdrLower || !pattern.test(actualHdrLower))) {
                            innerErr.push({
                                'headers': {
                                    'expected with matching rule': { key: key, value: hdrMatcher.regex },
                                    'actual': { key: key, value: actualHdr || actualHdrLower }
                                }
                            });
                        }
                    } else if (hdrMatcher.match) {
                        //TODO complete this part of the matcher
                    }
                } else {
                    if ((!actualHdr || actualHdr !== value) && (!actualHdrLower || actualHdrLower !== value)) {
                        innerErr.push({
                            'headers': {
                                'expected': { key: key, value: value },
                                'actual': { key: key, value: actualHdr || actualHdrLower}
                            }
                        });
                    }
                }
            });

            // compare body of actual and expected
            bodyMatcher = (function () {
                var matcher = [];
                _.each(matchingInteraction.interaction.request.requestMatchingRules, function (value, key) {
                    if (key.indexOf('$.body') === 0) {
                        matcher.push({
                            key : key.replace('$.body.', ''),
                            value : value
                        });
                    }
                });
                return matcher.length > 0 ? matcher : undefined;
            }());
            if (useMatchers && bodyMatcher) {
                _.each(bodyMatcher, function (item) {
                    if (item.value.regex) {
                        var val = _.get(body, item.key);
                        if (!val || !(new RegExp(item.value.regex)).test(val)) {
                            innerErr.push({
                                'body': {
                                    'expected with matching rule': { key: item.key, value: item.value.regex },
                                    'actual': { key: item.key, value: val }
                                }
                            });
                        }
                    } else if (item.value.match) {
                        //TODO complete this part of the matcher
                    }
                });
            } else {
                if (!_.isEqual(matchingInteraction.interaction.request.body || {}, body || {})) {
                    innerErr.push({
                        'body': {
                            'expected': matchingInteraction.interaction.request.body,
                            'actual': body
                        }
                    });
                }
            }

            if (innerErr.length === 0) {
                selectedInteraction = matchingInteraction;
            } else {
                interactionDiffs.push(innerErr);
            }
        });
        if (selectedInteraction) {
            successCallback(selectedInteraction);
        } else {
            errorCallback({
                'message': 'No interaction found for ' + method + ' ' + path + ' ' + JSON.stringify(query),
                'interaction_diffs': interactionDiffs
            });
        }
    },
    registerInteractions = function (req, res) {
        console.log('registerInteractions',req, res)

        var consumerName = req.headers['x-pact-consumer'],
            providerName = req.headers['x-pact-provider'],
            newInteractions = [],
            errors = [];

        if (req.body.interactions) {
            _.each(req.body.interactions, function (current) {
                newInteractions.push(current);
            });
        } else {
            newInteractions.push(req.body);
        }
        _.each(newInteractions, function (current) {
            if (process.env.CONVERT_MATCHING_RULES !== "false") {
                current.request.requestMatchingRules = current.request.requestMatchingRules || {};
                current.response.responseMatchingRules = current.response.responseMatchingRules || {};

                current.request.body = convertAllMatchers(current.request.body, current.request.requestMatchingRules, '$.body');
                current.request.query = convertAllMatchers(current.request.query, current.request.requestMatchingRules, '$.query');
                current.request.headers = convertAllMatchers(current.request.headers, current.request.requestMatchingRules, '$.headers');

                current.response.body = convertAllMatchers(current.response.body, current.response.responseMatchingRules, '$.body');
                current.response.headers = convertAllMatchers(current.response.headers, current.response.responseMatchingRules, '$.headers');

                if (current.request.requestMatchingRules !== undefined && _.isEmpty(current.request.requestMatchingRules)) {
                    delete current.request.requestMatchingRules;
                }

                if (current.response.responseMatchingRules !== undefined && _.isEmpty(current.response.responseMatchingRules)) {
                    delete current.response.responseMatchingRules;
                }
            }

            var interaction = {
                    method : current.request.method,
                    path : current.request.path,
                    query : current.request.query,
                    headers : current.request.headers,
                    body : current.request.body
                },
                successCallback = function (matchingInteraction) {
                    if (consumerName !== matchingInteraction.consumer || providerName !== matchingInteraction.provider) {
                        errors.push({
                            error: 'The interaction is already registered but against a different pair of consumer-provider',
                            interaction: current
                        });
                    } else {
                        Interactions.update({ _id: matchingInteraction._id }, { $inc: { expected: 1 } });
                    }
                },
                errorCallback = function () {
                    insertInteraction(consumerName, providerName, current, 1, 0);
                },
                areRulesOk = true;

            // make sure that the request matches any defined matching rule
            _.each(current.request.requestMatchingRules, function (value, key) {
                var fieldValues = jsonpath.query(current.request, escapeDashesInJsonPath(key));
                if (fieldValues.length === 0) {
                    errors.push({
                        error: 'The attribute ' + key + ' doesn\'t exist in the request object',
                        interaction: current
                    });
                    areRulesOk = false;
                } else {
                    for (var i=0; i<fieldValues.length; i++) {
                        fieldValue = fieldValues[i];
                        if (value.regex) {
                            // special case for query
                            if (key === "$.query" && typeof fieldValue === "object") {
                                fieldValue = querystring.encode(fieldValue);
                            }
                            if (!(new RegExp(value.regex)).test(fieldValue)) {
                                errors.push({
                                    error: 'The value of ' + key + ' (' + fieldValue + ') doesn\'t match the defined regex rule in the request: ' + value.regex,
                                    interaction: current
                                });
                                areRulesOk = false;
                            }
                        } else if (value.min !== undefined && fieldValue.length < value.min) {
                                errors.push({
                                    error: 'The length of ' + key + ' (' + fieldValue.length + ') is less than the minimum (' + value.min + ')',
                                    interaction: current
                                });
                                areRulesOk = false;
                        } else if (value.max !== undefined && fieldValue.length > value.max) {
                                errors.push({
                                    error: 'The length of ' + key + ' (' + fieldValue.length + ') is greater than the maximum (' + value.max + ')',
                                    interaction: current
                                });
                                areRulesOk = false;
                        }
                    }
                }
            });
            // make sure that the response matches any defined matching rule
            _.each(current.response.responseMatchingRules, function (value, key) {
                var fieldValues = jsonpath.query(current.response, escapeDashesInJsonPath(key));
                if (fieldValues.length === 0) {
                    errors.push({
                        error: 'The attribute ' + key + ' doesn\'t exist in the response object',
                        interaction: current
                    });
                    areRulesOk = false;
                } else {
                    for (var i=0; i<fieldValues.length; i++) {
                        fieldValue = fieldValues[i];
                        if (value.regex) {
                            if (!(new RegExp(value.regex)).test(fieldValue)) {
                                errors.push({
                                    error: 'The value of ' + key + ' (' + fieldValue + ') doesn\'t match the defined regex rule in the response: ' + value.regex,
                                    interaction: current
                                });
                                areRulesOk = false;
                            }
                        } else if (value.min !== undefined && fieldValue.length < value.min) {
                                errors.push({
                                    error: 'The length of ' + key + ' (' + fieldValue.length + ') is less than the minimum (' + value.min + ')',
                                    interaction: current
                                });
                                areRulesOk = false;
                        } else if (value.max !== undefined && fieldValue.length > value.max) {
                                errors.push({
                                    error: 'The length of ' + key + ' (' + fieldValue.length + ') is greater than the maximum (' + value.max + ')',
                                    interaction: current
                                });
                                areRulesOk = false;
                        }
                    }
                }
            });

            if (areRulesOk) {
                findInteraction(interaction, successCallback, errorCallback);
            }
        });
        if (errors.length > 0) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errors));
        } else {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Set interactions for ' + consumerName + '-' + providerName);
        }
    },
    verifyInteractions = function (req, res) {
        console.log("verifyInteractions",req, res)
        var registeredReqs = Interactions.find({
            consumer: req.headers['x-pact-consumer'],
            provider: req.headers['x-pact-provider'],
            expected: { $gt: 0 },
            disabled: false
        }).fetch(),
            missingReqs = _.filter(registeredReqs, function (current) {
                return current.count < current.expected;
            }),
            unexpectedRegisteredReqs = _.filter(registeredReqs, function (current) {
                return current.count > current.expected;
            }),
            unexpectedReqs = Interactions.find({ expected: 0 }).fetch(),
            resText;

        if (missingReqs.length === 0 && unexpectedRegisteredReqs.length === 0 && unexpectedReqs.length === 0) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Interactions matched');
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            resText = 'Actual interactions do not match expected interactions.\n';
            if (missingReqs.length > 0) {
                resText += '\nMissing requests:\n';
                _.each(missingReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + (element.expected - element.count) + ' missing request/s)\n';
                });
            }
            if (unexpectedRegisteredReqs.length > 0) {
                resText += '\nRegistered but unexpected number of requests:\n';
                _.each(unexpectedRegisteredReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + (element.count - element.expected) + ' unexpected request/s)\n';
                });
            }
            if (unexpectedReqs.length > 0) {
                resText += '\nUnexpected requests:\n';
                _.each(unexpectedReqs, function (element) {
                    resText += '\t' + element.consumer + '-' + element.provider + ': ';
                    resText += element.interaction.request.method.toUpperCase() + ' ';
                    resText += element.interaction.request.path;
                    resText += ' (' + element.count + ' unexpected request/s)\n';
                });
            }
            res.end(resText);
        }
    },
    createPact = function (consumer, provider) {
        console.log('createPact',consumer, provider)

        var interactions = Interactions.find({
            $and : [{ $or : [{ consumer: consumer }, { consumer: NULL }] },
                    { $or : [{ provider: provider }, { provider: NULL }] }],
            disabled: false
        }).fetch(),
            pact = {
                consumer: {
                    name: consumer
                },
                provider: {
                    name: provider
                },
                interactions: [],
                metadata: {
                    'pact-specification': {
                        version: '2.0.0'
                    },
                    'pact-mock-reactive': {
                        version: '0.1.0'
                    }
                }
            };
        _.each(interactions, function (element) {
            // Even though the client supports sending queries as objects or as strings, the maven plugin that verifies the contract
            // fails if queries are object, so we convert it here to string. This behavior may be disabled by setting the QUERIES_ONLY_AS_STRING
            // environment variable to "false"
            if (process.env.QUERIES_ONLY_AS_STRING !== "false") {
                if (element.interaction.request && element.interaction.request.query && typeof element.interaction.request.query === "object") {
                    element.interaction.request.query = querystring.encode(element.interaction.request.query);
                }
            }
            pact.interactions.push(element.interaction);
        });
        return pact;
    },
    writePact = function (req, res) {
        console.log('writePact',req, res)

        if (req.body.consumer && req.body.consumer.name && req.body.provider && req.body.provider.name) {
            var pact = createPact(req.body.consumer.name, req.body.provider.name),
                filename = (req.body.consumer.name.toLowerCase() + '-' + req.body.provider.name.toLowerCase()).replace(/\s/g, '_'),
                pactsDir = process.env.PACTS_DIR || appRoot + 'pacts',
                path = pactsDir + '/' + filename + '.json';
            fs.writeFile(path, JSON.stringify(pact, null, 4), function (err) {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 'message': 'Error ocurred in mock service: RuntimeError - pact file couldn\'t be saved' }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(pact));
                }
            });
        } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 'message': 'Error ocurred in mock service: RuntimeError - You must specify a consumer and provider name' }));
        }
    },
    requestsHandler = function (method, path, query, req, res) {
        var interaction = {
            method : method,
            path : path,
            query : query,
            headers : req.headers,
            body : req.body
        },
            successCallback = function (selectedInteraction) {
                var expectedResponse = selectedInteraction.interaction.response,
                    expectedBody = expectedResponse.body;
                Interactions.update({ _id: selectedInteraction._id }, { $inc: { count: 1 } });
                res.writeHead(expectedResponse.status, expectedResponse.headers);
                res.end(_.isObject(expectedBody) ? JSON.stringify(expectedResponse.body) : expectedBody);
            },
            errorCallback = function (err) {
                // this is an unexpected interaction, verify if it has happened before
                var innerSuccessCallback = function (selectedInteraction) {
                    Interactions.update({ _id: selectedInteraction._id }, { $inc: { count: 1 } });
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(err));
                },
                    innerErrorCallback = function () {
                        insertInteraction(NULL, NULL, {
                            request: {
                                method: method.toLowerCase(),
                                path: path,
                                query: query,
                                headers: req.headers,
                                body: req.body
                            },
                            reponse: {}
                        }, 0, 1);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(err));
                    },
                    selector = {
                        expected: 0
                    };
                findInteraction(interaction, innerSuccessCallback, innerErrorCallback, selector);
            };
        findInteraction(interaction, successCallback, errorCallback, undefined, true);
    },
    routeInteractions = function (route) {
        var headers = route.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            registerInteractions(route.request, route.response);
        } else {
            requestsHandler(route.method, route.url, route.params.query, route.request, route.response);
        }
    },
    routePact = function (route) {
        var headers = route.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            writePact(route.request, route.response);
        } else {
            requestsHandler(route.method, route.url, route.params.query, route.request, route.response);
        }
    };

Router.onBeforeAction(Iron.Router.bodyParser.text({
    'type': 'application/xml'
}));


Router.route('/interactions', { where: 'server' })
    .post(function () {
        normalizeConsumerProvider(this.request);
        routeInteractions(this);
    })
    .put(function () {
        normalizeConsumerProvider(this.request);
        routeInteractions(this);
    })
    .delete(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            normalizeConsumerProvider(this.request);
            deleteInteractions(this.request);
            this.response.writeHead(200, { 'Content-Type': 'text/plain' });
            this.response.end('Deleted interactions');
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/interactions/verification', { where: 'server' })
    .get(function () {
        var headers = this.request.headers;
        if (headers['x-pact-mock-service'] === 'true') {
            normalizeConsumerProvider(this.request);
            verifyInteractions(this.request, this.response);
        } else {
            requestsHandler(this.method, this.url, this.params.query, this.request, this.response);
        }
    });

Router.route('/pact', { where: 'server' })
    .post(function () {
        routePact(this);
    })
    .put(function () {
        routePact(this);
    });

Router.route('(.+)', function () {
    if (this.url === '/favicon.ico') {
        this.response.writeHead(200, { 'Content-Type': 'application/json' });
        this.response.end();
    } else {
        requestsHandler(this.method, '/' + this.params, this.params.query, this.request, this.response);
    }
}, { where: 'server' });

Meteor.methods({
    resetInteractions: function () {
        Interactions.update({ expected: { $gt: 0 } }, { $set : { count: 0 } }, { multi: true });
        Interactions.remove({ expected: 0 });
    },
    clearInteractions: function () {
        Interactions.remove({});
    },
    addInteraction: function (consumer, provider, interaction) {
        console.log("addInteraction",consumer, provider, interaction)
        console.log("interaction.request.method",interaction.request.method)
        if (!consumer || !consumer.length) {
            consumer = NULL;
        }
        if (!provider || !provider.length) {
            provider = NULL;
        }
        var selector = {
            method : interaction.request.method,
            path : interaction.request.path,
            query : interaction.request.query,
            headers : interaction.request.headers,
            body : interaction.request.body
        },
            successCallback = function (matchingInteraction) {
                console.log("successCallback",matchingInteraction)

                if (consumer === matchingInteraction.consumer && provider === matchingInteraction.provider) {
                    Interactions.update({ _id: matchingInteraction._id }, { $inc: { expected: 1 } });
                }
            },
            errorCallback = function () {
                console.log("errorCallback",errorCallback)

                insertInteraction(consumer, provider, interaction, 1, 0);
            };
        findInteraction(selector, successCallback, errorCallback);
    },
    writePacts: function (pairs) {
        console.log("writePacts",pairs)

        var res = {};
        _.each(pairs, function (p) {
            writePact(p, res);
        });
    }
});

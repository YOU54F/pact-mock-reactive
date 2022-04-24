var escapeMetaCharacters = function (string) {
    return string.replace(/\$/g, '\\uff04').replace(/\./g, '\\uff0E');
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
    }),
    syntaxHighlight = function (json) {
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            var cls = 'blue';
            //The next code is available if we want to change the color according to the value type
            /*if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'key';
                } else {
                    cls = 'string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'boolean';
            } else if (/null/.test(match)) {
                cls = 'null';
            }*/
            return '<span class="' + cls + '">' + match + '</span>';
        });
    };

Router.route('/', function () {
    return;
});

Meteor.startup(function () {
    // code to run on client at startup
    Session.setDefault({
        'description': "",
        'consumer': "",
        'provider': "",
        'provider_state': "",
        'method': "",
        'path': "/",
        'query': "",
        'reqHeaderObj': "",
        'reqObj': "",
        'resStatus': "",
        'resHeaderObj': "",
        'resObj': ""
    });

    $('.ui.accordion').accordion({ exclusive: false });

    $('.ui.pacts.modal')
        .modal('setting', 'transition', 'fade down')
        .modal('setting', 'can fit', 'true');

    $('.ui.add.modal')
        .modal({
            closable  : false,
            onDeny    : function () {
                return false;
            },
            onApprove : function () {
                var interaction = {
                    provider_state: Session.get('provider_state'),
                    description: Session.get('description'),
                    request: {
                        method: Session.get('method').toLowerCase() || "get",
                        path: Session.get('path') || "/",
                        query: JSON.parse(Session.get('query') || "{}"),
                        headers: JSON.parse(Session.get('reqHeaderObj') || "{}"),
                        body: JSON.parse(Session.get('reqObj') || "{}")
                    },
                    response: {
                        status: Session.get('resStatus'),
                        headers: JSON.parse(Session.get('resHeaderObj') || "{}"),
                        body: JSON.parse(Session.get('resObj') || "{}")
                    }
                };
                Meteor.call("addInteraction", Session.get('consumer'), Session.get('provider'), interaction);
            }
        });

    $('.ui.import.modal')
        .modal({
            onDeny    : function () {
                return false;
            },
            onApprove : function () {
                var pactFile = Session.get("importPactFile");
                _.each(pactFile.interactions, function (interaction) {
                    Meteor.call("addInteraction", pactFile.consumer.name, pactFile.provider.name, interaction);
                });
            }
        });


});

Template.body.helpers({
    interactions: function () {
        return Interactions.find();
    },
    interactionsHelper: function () {
        return JSON.stringify(Interactions.find().fetch());
    }
});

Template.body.events({
    'click #resetbutton': function () {
        Meteor.call("resetInteractions");
    },
    'click #clearbutton': function () {
        Meteor.call("clearInteractions");
    },
    'click #pactsbutton': function () {
        $('.ui.pacts.modal').modal('show');
    },
    'click #addbutton': function () {
        $('.ui.add.modal').modal('show');
    },
    'click #importbutton': function () {
        Session.set("importFilename", "");
        Session.set("importPactFile", "");
        $('.ui.import.modal').modal('show');
    }
});

Template.interaction.helpers({
    colorHelper: function () {
        var color = "gray";
        if (!this.disabled) {
            if (this.count !== this.expected) {
                color = "red";
            } else {
                color = "green";
            }
        }
        return color;
    },
    allowDecrementHelper: function () {
        return this.expected <= 1 ? "disabled" : "";
    },
    unexpectedDisabledHelper: function () {
        return this.expected === 0 ? "disabled" : "";
    },
    countHelper: function () {
        var label = "Received";
        if (this.expected > 0) {
            if (this.count > 0) {
                label += " (" + this.count + "/" + this.expected + ")";
            } else {
                label = "Missing (" + this.expected + ")";
            }
        } else {
            label = "Unexpected";
            if (this.count > 1) {
                label += " (" + this.count + ")";
            }
        }
        return label;
    },
    disabledHelper: function () {
        return this.disabled;
    },
    queryHelper: function (object) {
        var query = object;
        if (query && typeof query === "object") {
            query = $.param(query);
        }
        return query ? "?" + decodeURIComponent(query) : query;
    },
    jsonHelper: function (object) {
        return syntaxHighlight(JSON.stringify(object || {}, null, 4));
    }
});

Template.interaction.events({
    'click #incrementInteraction': function () {
        Interactions.update({ _id: this._id }, { $inc: { expected: 1 } });
    },
    'click #decrementInteraction': function () {
        Interactions.update({ _id: this._id }, { $inc: { expected: -1 } });
    },
    'click #removeInteraction': function () {
        Interactions.remove(this._id);
    },
    'click #toggleInteraction': function () {
        Interactions.update({ _id: this._id }, { $set: { disabled: !this.disabled } });
    }
});

Template.showPacts.helpers({

    
    pacts: function () {
        console.log('Template.showPacts.helpers')
        var str = "",
            pact = {},
            interactions = Interactions.find({
    }).fetch(),
            groupedInteractions = _.groupBy(interactions, function (element) {
                return element.consumer + element.provider;
            }),
            pairs = [];
            console.log('Interactions',Interactions)
            console.log(interactions)
        _.each(groupedInteractions, function (value) {
            console.log('trying to show each interaction')
            console.log(value)

            str += "<span class='black'><b>Pact between " + value[0].consumer + " and " + value[0].provider + ":</b></span><br/>";
            pact = {
                consumer: {
                    name: value[0].consumer
                },
                provider: {
                    name: value[0].provider
                }
            };
            pairs.push(pact);
            pact.interactions = [];
            _.each(value, function (element) {
                pact.interactions.push(element.interaction);
            });

            str += '<pre class="black">' + syntaxHighlight(JSON.stringify(pact, null, 4)) + "</pre><br/><br/>";
        });

        Session.set("pairsConsumerProvider", pairs);
        return str ? str.substring(0, str.length - 10) : str;
    }
});

Template.addInteraction.helpers({
    validStr: function (param) {
        return param.length === 0 ? "error" : "";
    },
    validCode: function (param) {
        return (/^[0-9]+$/).test(param) ? "" : "error";
    },
    validObj: function (param) {
        if (!param) {
            return "";
        }
        try {
            JSON.parse(param);
        } catch (e) {
            return "error";
        }
        return "";
    },
    description: function () {
        return Session.get('description');
    },
    consumer: function () {
        return Session.get('consumer');
    },
    provider: function () {
        return Session.get('provider');
    },
    provider_state: function () {
        return Session.get('provider_state');
    },
    method: function () {
        return Session.get('method');
    },
    path: function () {
        return Session.get('path');
    },
    query: function () {
        return Session.get('query');
    },
    reqHeaderObj: function () {
        return Session.get('reqHeaderObj');
    },
    reqObj: function () {
        return Session.get('reqObj');
    },
    resStatus: function () {
        return Session.get('resStatus');
    },
    resHeaderObj: function () {
        return Session.get('resHeaderObj');
    },
    resObj: function () {
        return Session.get('resObj');
    },
    verbs: function () {
        var verbs = [
            { name: "GET" },
            { name: "POST" },
            { name: "PUT" },
            { name: "DELETE" },
            { name: "PATCH" }
        ];
        return verbs;
    }
});

Template.addInteraction.events({
    'change input': function (event) {
        Session.set(event.target.id, event.target.value);
    },
    'change textarea': function (event) {
        Session.set(event.target.id, event.target.value);
    },
    'change #method': function (event) {
        Session.set(event.target.id, event.target.value);
    }
});

Template.importPactFile.helpers({
    filename: function () {
        return Session.get("importFilename");
    }
});

Template.importPactFile.events({
    'change .importPactFile': function (event) {
        console.log('saf')
        var reader = new FileReader();
        console.log(reader)

        reader.onload = function (e) {
            console.log(JSON.parse(e.target.result))
            console.log(event.target.files[0].name)
            console.log('bsaf')

            Session.set("importPactFile", JSON.parse(e.target.result));
            Session.set("importFilename", event.target.files[0].name);
        };
        reader.readAsText(event.target.files[0]);

    }
});

var OUTPUT_DIR = "out";
var OUTPUT_SUFFIX = ".json";
var URL_PREFIX = "http://json-schema.org/schemas/";
var URL_SUFFIX = '.json';
var REL_PREFIX = 'http://schema.org/';

var path = require('path');
var fs = require('fs');
var request = require('request');

var prettyJson = require('./pretty-json');
var hardcodedSchemas = require('./hardcoded-schemas.json');
var propertyMultiplicity = require('./property-multiplicity.json');
var ignoreProperties = require('./ignore-properties.json');

try {
	fs.mkdirSync(OUTPUT_DIR);
} catch (e) {
}

request.get('http://schema.rdfs.org/all.json', function (err, request, body) {
	if (err) throw err;
	
	var allData = JSON.parse(body);
	
	var allSchemas = {};
	
	function getHardcoded(key) {
		return JSON.parse(JSON.stringify(hardcodedSchemas[key]));
	}
	
	function merge(objA) {
		var result = {};
		for (var i = 0; i < arguments.length; i++) {
			var obj = arguments[i];
			for (var key in obj) {
				result[key] = obj[key];
			}
		}
		return result;
	}
	
	function trimSchema(schema) {
		if (!schema.title) {
			delete schema.title;
		}
		if (!schema.description) {
			delete schema.description;
		}
		if (schema.type.length == 0) {
			delete schema.type;
		}		
		if (schema.allOf.length == 0) {
			delete schema.allOf;
		}		
		if (Object.keys(schema.properties).length == 0) {
			delete schema.properties;
			if (schema.type == 'object' && schema.allOf) {
				delete schema.type;
			}
		}
		if (Object.keys(schema.definitions).length == 0) {
			delete schema.definitions;
		}
		return schema;
	}
	
	function createSchema(key, spec) {
		var schema = {
			'id': URL_PREFIX + spec['id'] + URL_SUFFIX,
			'title': spec['label'],
			'description': spec['comment_plain'],
			'format': spec['url'],
			"allOf": [],
			"type": [],
			"properties": {},
			'definitions': {}
		};
		if (spec.instances) {
			schema['enum'] = spec.instances;
		} else {
			schema.type = 'object';
			schema.properties = {};
			schema.definitions.array = {
				"type": "array",
				"items": {"$ref": "#"}
			};
			if (hardcodedSchemas[key]) {
				return trimSchema(merge(schema, getHardcoded(key)));
			}
			schema.definitions.possibleRef = {
				"oneOf": [
					{"$ref": "#"},
					{
						"type": "string",
						"format": "uri",
						"links": [{
							"rel": "full",
							"href": "{+$}"
						}]
					}
				]
			};
			schema.definitions.possibleRefArray = {
				"type": "array",
				"items": {"$ref": "#/definitions/possibleRefArray"}
			};
			schema.allOf = spec.supertypes.map(function (supertype) {
				return {"$ref": supertype + URL_SUFFIX};
			});
			spec.specific_properties.forEach(function (key) {
				if (key === 'array' || key === 'possibleRef' || key === 'possibleRefArray') {
					throw new Error('Not allowed key: ' + key);
				}
				var propSpec = allData.properties[key];
				if (ignoreProperties[key] || /\(legacy spelling;/.test(propSpec['comment_plain'])) {
					ignoreProperties[key] = true;
					return;
				}
				if (hardcodedSchemas[key]) {
					schema.properties[key] = getHardcoded(key);
				} else {
					var options = [];
					propSpec.ranges.forEach(function (type) {
						if (hardcodedSchemas[type]) {
							options.push(getHardcoded(type));
						} else {
							options.push({"$ref": type + URL_SUFFIX + "#/definitions/possibleRef"});
						}
					});
					if (options.length == 1) {
						schema.properties[key] = options[0];
						if (options[0].format === 'uri') {
							options[0].links = [{
								"rel": "full",
								"href": "{+$}"
							}];
							delete schema.definitions.possibleRef
						}
					} else {
						schema.properties[key] = {"anyOf": options};
					}
				}
				if (!schema.properties[key]['$ref']) {
					var subSchema = schema.properties[key];
					subSchema = merge({
						title: propSpec['label'],
						description: propSpec['comment_plain']
					}, subSchema);
					schema['definitions'][key] = subSchema
					schema['properties'][key] = {"$ref": '#/definitions/' + key}
				}
				var description = propSpec['comment_plain'];
				if (typeof propertyMultiplicity[key] !== 'boolean') {
					if (/^An? /.test(description)) {
						propertyMultiplicity[key] = true;
					} else if (/^The /.test(description) || /^is[A-Z]/.test(key)) {
						propertyMultiplicity[key] = false;
					} else {
						propertyMultiplicity[key] = description;
					}
				}
				if (propertyMultiplicity[key] === true) {
					var subSchema = schema['properties'][key];
					if (subSchema['$ref'] && /^[^#]+#\/definitions\/possibleRef?$/.test(subSchema['$ref'])) {
						subSchema['$ref'] += 'Array';
					} else {
						schema.properties[key] = {
							type: "array",
							items: subSchema
						};
					}
				} else if (propertyMultiplicity[key] !== false) {
					var subSchema = schema['properties'][key];
					schema.properties[key] = {
						oneOf: [
							subSchema,
							{
								type: "array",
								items: subSchema
							}
						]
					};
				}
			});
		}
		
		return trimSchema(schema);
	}

	for (var key in allData.types) {
		allSchemas[key] = createSchema(key, allData.types[key]);
	}
	for (var key in allData.types) {
		var spec = allData.types[key];
		var filename = path.join(OUTPUT_DIR, spec.id + OUTPUT_SUFFIX);
		fs.writeFileSync(filename, prettyJson(allSchemas[key]));
	}
	
	fs.writeFileSync('./property-multiplicity.json', prettyJson(propertyMultiplicity));
	fs.writeFileSync('./ignore-properties.json', prettyJson(ignoreProperties));
});

// Copyright (c) 2014-2017 Vinny Coyne (http://www.vinnycoyne.com)

var express = require('express');
var request = require('request');
var bodyParser = require('body-parser');
var cheerio = require('cheerio');
var turf = require('@turf/turf');
var moment = require('moment-timezone');
var app = express();

var port = Number(process.env.PORT || 8001);

var endpoint = 'https://data.dublinked.ie/cgi-bin/rtpi';

// parse application/json
app.use(bodyParser.json());


// Initialise caches
global.init_cache = function() {

	global.formatted_routes_strings = {};
	global.formatted_routes_timestamps = {};

	global.translations = [];

	global.bus_locations = {}
	
	request('http://localhost:' + port + '/routes.json', function(error, response, body) {

		// Warm up the cache for each route.

		if ((!error) && (response.statusCode == 200)) {

			var json = JSON.parse(body);

			for (var key in json) {

				if (json.hasOwnProperty(key)) {
					
					request('http://localhost:' + port + '/routes/' + key + '.json', function(e, r, b) {
					});
				}
			}
		}

	});
	
	request('http://localhost:' + port + '/stops.json', function(error, response, body) {
	});

	console.log("Cache initialised.");
}

// PARSING

var parseRealTimesForStopRef = function(stop_ref) {

	return new Promise((resolve, reject) => {

		var url =  endpoint + '/realtimebusinformation?maxresults=10&operator=be&stopid=' + stop_ref;
		
		request(url, function(error, response, body) {
			
			if (!error) {

				if ((!error) && (response.statusCode == 200)) {

					var json = JSON.parse(body);

					var error_code = json["errorcode"];

					if ((error_code) && ((parseInt(error_code) == 0) || (parseInt(error_code) == 1))) {

						var results = json["results"];

						var times = [];

						var is_dst = moment.tz("Europe/Dublin").isDST();

						var parse_time = function(json_time_object) {

							formatted_time = new Object();
							formatted_time['display_name'] = json_time_object['destination'];
							formatted_time['irish_display_name'] = json_time_object['destinationlocalized'];
							formatted_time['timetable_id'] = json_time_object['route'];
							formatted_time['low_floor'] = json_time_object['lowfloorstatus'] === 'yes';


							// Convert 'dd/MM/yyyy HH:mm:ss' string into ISO format.

							var date_string = json_time_object['departuredatetime'];

							if ((date_string != null) && (date_string.length > 0)) {

								var date_string_with_tz = "";

								// Bloody API doesn't specify time with timezone.
								if (is_dst == true) {
									date_string_with_tz = date_string + "+0100";
								}
								else {
									date_string_with_tz = date_string + "+0000";
								}

								var m = moment(date_string_with_tz, "DD/MM/yyyy HH:mm:ssZ");

								formatted_time['depart_timestamp'] = m.toISOString();
							}

							return formatted_time;
						};

						// Convert JSON to native object.
						times = results.map(function(json_time) {
							return parse_time(json_time);
						});

						resolve(times);

						return;
					}
				}				
			}

			reject('{\"error\" : \"An error occurred.\", \"code\" : 500}');
			
		});
		
	});

};


// ROUTING

// Always use application/json;charset=utf-8 as the Content-Type,
// except for the index.html request.
app.use(function(req, res, next) {
	
	if ((req.url == '/') || (req.url == '/index.html')) {
		res.contentType('text/html');
	}
	else {
		res.contentType('application/json;charset=utf-8');
	}

	next();
});


// GET /nearby.json
// Returns list of nearby stops.
app.get('/stops/nearby.json', function(req, res) {

	var units = "meters";

	var latitude = parseFloat(req.query.latitude);
	var longitude = parseFloat(req.query.longitude);
	var timetable_id = req.query.route;

	var point = turf.point([longitude, latitude]);

	var point_from_stop = function(stop) {

		var lat = parseFloat(stop['latitude']);
		var lon = parseFloat(stop['longitude']);

		var stop_point = turf.point([lon, lat]);

		return stop_point;

	};

	var sort_distance = function(s1, s2) {

		var p1 = point_from_stop(s1);
		var p2 = point_from_stop(s2);

		var d1 = turf.distance(point, p1, units);
		var d2 = turf.distance(point, p2, units);

		s1['distance'] = d1;
		s2['distance'] = d2;

		return d1 - d2;
	};



	var sorted_stops = global.formatted_stops.sort(sort_distance);

	if (timetable_id != null) {

		sorted_stops = sorted_stops.filter(function(element) {
			return (element['routes'] != null) && (element['routes'].indexOf(timetable_id) != -1);
		});
	}

	if (sorted_stops.length > 10) {
		sorted_stops = sorted_stops.slice(0, 10);
	}

	var sorted_stop_ref_promises = sorted_stops.map(function(stop) {
		return parseRealTimesForStopRef(stop['stop_ref']);
	});

	Promise.all(sorted_stop_ref_promises).then(times => { 

		var sorted_stops_with_times = sorted_stops.map(function(stop, index) {
			stop['times'] = times[index];
			return stop;
		});

	  res.status(200).send(JSON.stringify(sorted_stops_with_times));
	}).catch(error => {
		// Fall back to returning just the stops.
		res.status(200).send(JSON.stringify(sorted_stops));
	});
});


// GET /routes.json
// Returns a list of routes.
app.get('/routes.json', function(req, res) {
	
	var routes = new Object();
	
	routes[401] = { 'timetable_id' : 401, 'long_name' : 'Salthill - Eyre Square - Parkmore', 'short_name' : 'Salthill - Parkmore' };
	routes[402] = { 'timetable_id' : 402, 'long_name' : 'Seacrest - Eyre Square - Merlin Park', 'short_name' : 'Seacrest - Merlin Park' };
	routes[404] = { 'timetable_id' : 404, 'long_name' : 'Newcastle - Eyre Square - Oranmore', 'short_name' : 'Newcastle - Oranmore' };
	routes[405] = { 'timetable_id' : 405, 'long_name' : 'Rahoon - Eyre Square - Ballybane', 'short_name' : 'Rahoon - Ballybane' };
	routes[407] = { 'timetable_id' : 407, 'long_name' : 'Eyre Square - Bóthar an Chóiste', 'short_name' : 'Bóthar an Chóiste' };
	routes[409] = { 'timetable_id' : 409, 'long_name' : 'Eyre Square - GMIT - Parkmore', 'short_name' : 'Parkmore / GMIT' };
	
	res.status(200).send(JSON.stringify(routes));
	
	global.routes = routes;
	
});


// GET /routes/:timetable_id.json
// Returns a list of stops for a particular route/timetable
app.get('/routes/:timetable_id', function(req, res) {

	var timetable_id = req.params.timetable_id.replace('.json', '');
	var response_string = null;
	var code = 500;
	
	if (timetable_id) {

		if (global.formatted_routes_strings) {

			var cached_route = global.formatted_routes_strings[parseInt(timetable_id)];

			if ((cached_route) && (cached_route.length > 0)) {

				var cache_expired = false;
				
				// Flush the cache if older than 1 day.
				var timestamp = global.formatted_routes_timestamps[parseInt(timetable_id)];

				if (timestamp) {

					var now = new Date();
					
					if (now > timestamp) {
						cache_expired = true;
						global.formatted_routes_strings[parseInt(timetable_id)] = null;
						global.formatted_routes_timestamps[parseInt(timetable_id)] = null;
					}
				}
				
				// Respond with cached route JSON.
				if (!cache_expired) {
					console.log("/routes/" + timetable_id + ".json hitting cache.")
					res.status(200).send(cached_route);
					return;	
				}
			}
		}
		
		if (global.routes) {
			
			// Get the route/timetable info from the local cache.
			var route = global.routes[parseInt(timetable_id)];

			var options = {
				uri: endpoint + '/routeinformation?operator=be&routeid=' + timetable_id
			};
			
			request(options, function(error, response, body) {

				if ((!error) && (response.statusCode == 200)) {

					var response_object = new Object();
					response_object['route'] = route;

					var json = JSON.parse(body);

					var error_code = json["errorcode"];

					if ((error_code) && (parseInt(error_code) == 0)) {

						var directions = json["results"];

						var formatted_stops = [];

						var to_es_stops = [];
						var from_es_stops = [];

						var fallbackDestinationName = "";

						directions.forEach(function(direction) {

							var goingFrom = direction['origin'];
							var goingTo = direction['destination'];
							var altGoingFrom = direction['originlocalized'];
							var altGoingTo = direction['destinationlocalized'];

							var stops = direction["stops"];

							global.translations[goingFrom] = altGoingFrom;
							global.translations[goingTo] = altGoingTo;


							var format_stop = function(stop) {

								var formatted_stop = new Object();

								formatted_stop['stop_ref'] = stop['stopid'];
								formatted_stop['stop_id'] = parseInt(stop['stopid']);

								formatted_stop['long_name'] = stop['fullname'];
								formatted_stop['irish_long_name'] = stop['fullnamelocalized'];
								formatted_stop['short_name'] = stop['shortname'];
								formatted_stop['irish_short_name'] = stop['shortnamelocalized'];

								formatted_stop['latitude'] = parseFloat(stop['latitude']);
								formatted_stop['longitude'] = parseFloat(stop['longitude']);
								
								var operators = stop['operators'];

								if ((operators != null) && (operators.length > 0)) {

									var be_operators = operators.filter(function(element) {
										return element['name'] === 'BE';
									});

									if (be_operators.length > 0) {
										formatted_stop['routes'] = be_operators[0]['routes'];
									}
								}

								formatted_stop['from'] = goingFrom;
								formatted_stop['to'] = goingTo;

								formatted_stop['irish_from'] = altGoingFrom;
								formatted_stop['irish_to'] = altGoingTo;

								return formatted_stop;
							};

							// Convert JSON to native objects.
							var mapped_stops = stops.map(function(stop) {
								return format_stop(stop);
							});


							// Combine the various services into inboound/outbound arrays.
							if (direction['destination'] === "Eyre Square") {
								to_es_stops.push.apply(to_es_stops, mapped_stops);
							}
							else if (direction['origin'] === "Eyre Square") {
								from_es_stops.push.apply(from_es_stops, mapped_stops);
							}
							else {

								// Not all routes use Eyre Square as destination name anymore.
								// This is a fallback to handle that (mainly for 405 right now).

								if (fallbackDestinationName.length == 0) {
									fallbackDestinationName = direction['destination'];
								}

								if (direction['destination'] === fallbackDestinationName) {
									to_es_stops.push.apply(to_es_stops, mapped_stops);
								}
								else if (direction['origin'] === fallbackDestinationName) {
									from_es_stops.push.apply(from_es_stops, mapped_stops);
								}
							}
						});

						formatted_stops.push(to_es_stops);
						formatted_stops.push(from_es_stops);

						if (formatted_stops.length > 0) {

							response_object['stops'] = formatted_stops;

							response_string = JSON.stringify(response_object);
							code = 200;

							global.formatted_routes_strings[parseInt(timetable_id)] = response_string;

							var cache_expiration_date = new Date();
							cache_expiration_date.setHours(cache_expiration_date.getHours() + 24);
							global.formatted_routes_timestamps[parseInt(timetable_id)] = cache_expiration_date;

							console.log("Updated cache for route " + timetable_id + " (expires " + cache_expiration_date + ").");
						}
					}
				}

				if (!response_string) {
					response_string = '{\"error\" : \"An error occurred.\", \"code\" : 500}';
					code = 500;
				}

				res.status(code).send(response_string);
			});

			return;
		}
		else {
			// No routes are present in cache, so call the /routes API to attempt a fetch
			
			var url = 'http://' + req.hostname + ':' + port + '/routes.json';
			request(url, function(error, response, body) {
			});
		}
	}

	if (!response_string) {
		response_string = '{\"error\" : \"An error occurred.\", \"code\" : 500}';
		code = 500;
	}

	res.status(code).send(response_string);
});


// GET /schedules.json
// Returns PDF links for each route/timetable.
app.get('/schedules.json', function(req, res) {

	var schedules = new Object();

	schedules[401] = [ { 'Salthill - Eyre Square - Parkmore' : 'http://buseireann.ie/timetables/401-1536250364.pdf' } ];
	schedules[402] = [ { 'Seacrest - Eyre Square - Merlin Park' : 'http://buseireann.ie/timetables/402-1536317273.pdf' } ];
	schedules[404] = [ { 'Newcastle - Eyre Square - Oranmore' : 'http://buseireann.ie/timetables/404-1536325488.pdf' } ];
	schedules[405] = [ { 'Rahoon - Eyre Square - Ballybane' : 'http://buseireann.ie/timetables/405-1536327672.pdf' } ];
	schedules[407] = [ { 'Eyre Square - Bóthar an Chóiste and return' : "http://buseireann.ie/timetables/407-1536330823.pdf" } ];
	schedules[409] = [ { 'Eyre Square - GMIT - Parkmore' : 'http://buseireann.ie/timetables/409-1536332909.pdf' } ];

	res.status(200).send(JSON.stringify(schedules));

});


// GET /stops.json
// Returns a list of all bus stops.
app.get('/stops.json', function(req, res) {
	
	if ((global.stops_json_string) && (global.stops_json_string.length > 0)) {
		
		var cache_expired = false;
		
		// Flush the cache if older than 1 day.
		if (global.stops_timestamp) {
			
			var now = new Date();
			
			if (now > global.stops_timestamp) {
				cache_expired = true;
				global.stops_json_string = null;
				// global.formatted_stops = null;
				global.stops_timestamp = null;
			}
		}
		
		// Respond with cached stops JSON.
		if (!cache_expired) {
			console.log("/stops.json hitting cache.")
			res.status(200).send(global.stops_json_string);
			return;	
		}
	}
	
	
	// Call the RTPI API to get all stops available in the Galway region.
	
	var options = {
		uri: endpoint + '/busstopinformation?operator=be'
	};

	request(options, function(error, response, body) {

		var response_string = null;
		var code = 500;
		
		if ((!error) && (response.statusCode == 200)) {

			var json = JSON.parse(body);

			var error_code = json["errorcode"];

			if ((error_code) && (parseInt(error_code) == 0)) {

				var results = json["results"];

				var formatted_stops = [];
				global.formatted_stops = [];

				var eyre_square_coordinates = [-9.0514163, 53.2743426];
				var eyre_square_point = turf.point(eyre_square_coordinates);
				var units = "meters";

				var stop_in_galway = function(stop) {

					var lat = parseFloat(stop['latitude']);
					var lon = parseFloat(stop['longitude']);

					var stop_point = turf.point([lon, lat]);

					var distance_from_eyre_square = turf.distance(eyre_square_point, stop_point, units);

					return (distance_from_eyre_square < 25000.0);

				};

				// Create an object from the Stop JSON data.
				var parse_stop = function(json_stop_object) {

					formatted_stop = new Object();
					formatted_stop['short_name'] = json_stop_object['shortname'];
					formatted_stop['long_name'] = json_stop_object['fullname'];
					formatted_stop['stop_id'] = parseInt(json_stop_object['stopid']);
					formatted_stop['stop_ref'] = json_stop_object['stopid'];
					formatted_stop['latitude'] = parseFloat(json_stop_object['latitude']);
					formatted_stop['longitude'] = parseFloat(json_stop_object['longitude']);

					var operators = json_stop_object['operators'];

					if ((operators != null) && (operators.length > 0)) {

						var be_operators = operators.filter(function(element) {
							return element['name'] === 'BE';
						});

						if (be_operators.length > 0) {
							formatted_stop['routes'] = be_operators[0]['routes'];
						}
					}


					var irish_short_name = json_stop_object['shortnamelocalized'];
					var irish_long_name = json_stop_object['fullnamelocalized'];

					if ((irish_short_name) && (irish_short_name.length > 0) && ((!irish_long_name) || (irish_long_name.length == 0))) {
						irish_long_name = irish_short_name;
					}
					else if ((irish_long_name) && (irish_long_name.length > 0) && ((!irish_short_name) || (irish_short_name.length == 0))) {
						irish_short_name = irish_long_name;
					}

					formatted_stop['irish_short_name'] = irish_short_name;
					formatted_stop['irish_long_name'] = irish_long_name;

					formatted_stop['galway'] = stop_in_galway(json_stop_object);

					return formatted_stop;
				};

				results.forEach(function(json_stop) {

					var formatted_stop = parse_stop(json_stop);

					if (formatted_stop['galway'] == true) {
						formatted_stops.push(formatted_stop);
					}
					
				});

				global.formatted_stops.push.apply(global.formatted_stops, formatted_stops);

				response_string = JSON.stringify(global.formatted_stops);

				global.stops_json_string = response_string;

				var cache_expiration_date = new Date();
				cache_expiration_date.setHours(cache_expiration_date.getHours() + 24);
				global.stops_timestamp = cache_expiration_date;

				console.log("Updated cache for stops (expires " + cache_expiration_date + ").");
			}

			if (!response_string) {
				response_string = '{\"error\" : \"An error occurred.\", \"code\" : 500}';
				code = 500;
			}
			else {
				code = 200;
			}
		}

		if (!response_string) {
			response_string = '{\"error\" : \"An error occurred.\", \"code\" : 500}';
		}

		res.status(code).send(response_string);
	});
})


// GET /stops/:stop_ref.json
// Returns info for the bus stop, as well as RTPI data for that stop.
app.get('/stops/:stop_ref', function(req, res) {
	
	var stop_ref = req.params.stop_ref.replace('.json', '');
	var response_string = null;
	var code = 500;
	
	if (stop_ref) {
		
		// Hit the stops cache and fetch the stop with the same stop_ref ID.
		
		if (global.formatted_stops) {
			
			if (global.formatted_stops.length > 0) {
				
				var matched_stops = global.formatted_stops.filter(function(element) {
					return element['stop_ref'] === stop_ref;
				});
				
				if (matched_stops.length > 0) {
					
					// Store the stop object for the API response.
					var stop = new Object();
					stop['stop'] = matched_stops[0];

					parseRealTimesForStopRef(stop['stop']['stop_ref']).then(times => {
						// Store the times for API response.
						stop['times'] = times;
						res.status(200).send(JSON.stringify(stop));
					}).catch(error => {
						res.status(500).send(error);
					});
					
					return;
				}
			}
		}
		else {
			// No stops are present in cache, so call the /stops API to attempt a fetch
			
			var url = 'http://' + req.hostname + ':' + port + '/stops.json';
			request(url, function(error, response, body) {
			});
		}
	}
	
	if (!response_string) {
		response_string = '{\"error\" : \"An error occurred.\", \"code\" : 500}';
	}
	
	res.status(code).send(response_string);
	
});


app.use('/', express.static(__dirname + '/public'));

// 404
app.get('*', function(req, res){
	console.log("404: " + req.url);
	res.status(404).send('{\"error\" : \"An error occurred.\", \"code\" : 404}');
});


// Set up the server
app.listen(port);
exports = module.exports = app;
global.init_cache();

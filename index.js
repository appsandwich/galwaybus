var express = require('express');
var request = require('request');
var cheerio = require('cheerio');
var app = express();

var port = Number(process.env.PORT || 8000);


// Initialise caches
global.init_cache = function() {
	
	request('http://localhost:' + port + '/routes.json', function(error, response, body) {
	});
	
	request('http://localhost:' + port + '/stops.json', function(error, response, body) {
	});
}


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


// GET /routes.json
// Returns a list of routes.
app.get('/routes.json', function(req, res) {
	
	var routes = new Object();
	
	routes[401] = { 'timetable_id' : 401, 'long_name' : 'Salthill - Eyre Square', 'short_name' : 'Salthill' };
	routes[402] = { 'timetable_id' : 402, 'long_name' : 'Merlin Park - Eyre Square - Seacrest', 'short_name' : 'Merlin Park - Seacrest' };
	routes[403] = { 'timetable_id' : 403, 'long_name' : 'Castlepark - Eyre Square', 'short_name' : 'Castlepark' };
	routes[404] = { 'timetable_id' : 404, 'long_name' : 'Newcastle - Eyre Square', 'short_name' : 'Newcastle' };
	routes[405] = { 'timetable_id' : 405, 'long_name' : 'Ballybane - Eyre Square - Rahoon', 'short_name' : 'Ballybane - Rahoon' };
	routes[407] = { 'timetable_id' : 407, 'long_name' : 'Bóthar an Chóiste - Eyre Square', 'short_name' : 'Bóthar an Chóiste' };
	routes[409] = { 'timetable_id' : 409, 'long_name' : 'Parkmore Industrial Estate - Eyre Square', 'short_name' : 'Parkmore' };
	routes[410] = { 'timetable_id' : 410, 'long_name' : 'Oranmore - Eyre Square', 'short_name' : 'Oranmore' };
	
	res.send(200, JSON.stringify(routes));
	
	global.routes = routes;
	
});


// GET /routes/:timetable_id.json
// Returns a list of stops for a particular route/timetable
app.get('/routes/:timetable_id', function(req, res) {

	var timetable_id = req.params.timetable_id.replace('.json', '');
	var response_string = null;
	var code = 500;
	
	if (timetable_id) {
		
		if (global.routes) {
			
			// Get the route/timetable info from the local cache.
			var route = global.routes[parseInt(timetable_id)];
			
			
			// Call the RTPI API to retrieve the "services",
			// which we then use to get the list of stops along the route.
			
			var options = {
				uri: 'http://rtpi.ie/ConnectService.svc/GetPublicServicesForCriteriaSerialized',
				method: 'POST',
				json: {
					'searchString' : timetable_id,
					'districtId' : -1
				}
			};
			
			request(options, function(error, response, body) {
				
				if ((!error) && (response.statusCode == 200)) {
					
					// Parse the response into a valid JSON string.
					var json_string = JSON.stringify(body);
					json_string = json_string.substring(34, json_string.length - 2).replace(/\\/g, '');
					
					if (json_string.length > 0) {
						
						var json = JSON.parse(json_string);
						var json_services = json['FoundServices'];
						
						if (json_services.length > 0) {
							
							var response_object = new Object();
							response_object['route'] = route;
							
							var stops_container = [];
							
							// Track the number of API requests, so that we know when we're finished.
							var counter = 0;
							var total_requests = json_services.length;
							
							
							// Loop through each service, extract the "service variant IDs",
							// which we then use to retrieve the stops.
							
							json_services.forEach(function(service) {
								
								var service_variant_ids_string = '';
								
								service['ServiceVariantIds'].forEach(function(variant_id) {
									service_variant_ids_string += variant_id + ',';
								});
								
								var service_options = {
									uri: 'http://rtpi.ie/ConnectService.svc/GetServiceDataSerialized',
									method: 'POST',
									json: {
										'publicServiceCode' : timetable_id,
										'operatorID' : service['OperatorId'],
										'depotID' : service['DepotId'],
										'routeLineNodes' : 'none',
										'serviceVariantIDs' : service_variant_ids_string.substring(0, service_variant_ids_string.length - 1)
									}
								};
								
								request(service_options, function(service_error, service_response, service_body) {
									
									counter++;
									
									if ((!service_error) && (service_response.statusCode == 200)) {
										
										var stops = [];
										
										// Parse the response into a valid JSON string.
										json_string = JSON.stringify(service_body);
										json_string = json_string.substring(26, json_string.length - 2).replace(/\\/g, '');
										
										if (json_string.length > 0) {
											
											json = JSON.parse(json_string);
											
											var sub_stops = json['AllStops'];
											
											sub_stops.forEach(function(sub_stop) {
												
												var stop_ref = sub_stop['StopRef'];
												
												// Find the current stop in the cache.
												var matched_stops = global.formatted_stops.filter(function(element) {
													return element['stop_ref'] === stop_ref;
												});
												
												// Update the lat / lon and add to the array of stops.
												if (matched_stops.length > 0) {
													
													matched_stops.forEach(function(matched_stop) {
														
														matched_stop['latitude'] = sub_stop['Latitude'];
														matched_stop['longitude'] = sub_stop['Longitude'];
														
														stops.push(matched_stop);
													});
												}
												
											});
										}
										
										if (stops.length > 0) {
											stops_container.push(stops);
										}
									}
									
									// Check to see if we're finished downloading the stops.
									if (counter >= total_requests) {
										
										if (stops_container.length > 0) {
											response_object['stops'] = stops_container;
										}
										
										response_string = JSON.stringify(response_object);
										res.send(200, response_string);
									}
									
								});
							});
							
							return;
						}
					}		
				}
				
				res.send(code, response_string);
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

	res.send(code, response_string);
});


// GET /schedules.json
// Returns PDF links for each route/timetable.
app.get('/schedules.json', function(req, res) {

	var schedules = new Object();

	schedules[401] = [ { 'Salthill - Eyre Square' : 'http://www.buseireann.ie/pdf/1360756547-401.pdf' } ];
	schedules[402] = [ {  'Merlin Park - Eyre Square - Seacrest' : 'http://www.buseireann.ie/pdf/1360756548-402_Merlin-Park-Seacrest.pdf' }, { 'Seacrest - Eyre Square - Merlin Park' : 'http://www.buseireann.ie/pdf/1360756623-402_Seacrest-Merlin-Park.pdf' } ];
	schedules[403] = [ {  'Eyre Square - Castlepark' : 'http://www.buseireann.ie/pdf/1360847232-403_Eyre-Square-Castlepark.pdf' }, { 'Castlepark - Eyre Square' : 'http://www.buseireann.ie/pdf/1360847233-403_Castlepark-EyreSquare.pdf' } ];
	schedules[404] = [ {  'Eyre Square - Newcastle' : 'http://www.buseireann.ie/pdf/1360756626-404_Eyre-Square-Newcastle.pdf' }, { 'Newcastle - Eyre Square' : 'http://www.buseireann.ie/pdf/1360756699-404_Newcastle-Eyre-Square.pdf' } ];
	schedules[405] = [ {  'Ballybane - Eyre Square - Rahoon' : 'http://www.buseireann.ie/pdf/1360756700-405_Ballybane-Rahoon.pdf' }, { 'Rahoon - Eyre Square - Ballybane' : 'http://www.buseireann.ie/pdf/1360756701-405_Rahoon-Ballybane.pdf' } ];
	schedules[407] = [ {  'Eyre Square - Bóthar an Chóiste and return' : "http://www.buseireann.ie/pdf/1360756547-401.pdf" } ];
	schedules[409] = [ {  'Parkmore Ind. Estate - Eyre Square' : 'http://www.buseireann.ie/pdf/1360756795-409_Parkmore-Ind-Estate-Eyre-Square.pdf' } ];
	schedules[410] = [ {  'Eyre Square - Oranmore' : 'http://www.buseireann.ie/pdf/1360756796-410_Eyre-Square-Oranmore.pdf' }, { 'Oranmore - Eyre Square' : 'http://www.buseireann.ie/pdf/1360756797-410_Oranmore-Eyre-Square.pdf' } ];

	res.send(200, JSON.stringify(schedules));

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
				global.formatted_stops = null;
				global.stops_timestamp = null;
			}
		}
		
		// Respond with cached stops JSON.
		if (!cache_expired) {
			res.send(global.stops_json_string);
			return;	
		}
	}
	
	
	// Call the RTPI API to get all stops available in the Galway region.
	
	var options = {
		uri: 'http://rtpi.ie/ConnectService.svc/GetClusteredStops',
		method: 'POST',
		json: {
			'topLeft': { 'lon' : -9.1775166093531, 'lat' : 53.346860746602, 'CLASS_NAME' : 'OpenLayers.LonLat' },
			'bottomRight': { 'lon' : -8.9358173906463, 'lat' : 53.194102800494, 'CLASS_NAME' : 'OpenLayers.LonLat' },
			'zoomLevel' : 10
		}
	};
	
	request(options, function(error, response, body) {
		
		var response_string = null;
		var code = 500;
		
		if ((!error) && (response.statusCode == 200)) {
			
			// Parse the response into a valid JSON string.
			var json_string = JSON.stringify(body);
			json_string = json_string.substring(22, json_string.length - 2).replace(/\\/g, '');
			
			if (json_string.length > 0) {
				
				var json = JSON.parse(json_string);
				var json_stops = json['AllFoundStops'];
				
				if (json_stops.length > 0) {
					
					var formatted_stops = [];
					
					// Make the format look pretty :)
					json_stops.forEach(function(json_stop) {
						
						formatted_stop = new Object();
						formatted_stop['short_name'] = json_stop['StopNameShort'];
						formatted_stop['long_name'] = json_stop['StopNameLong'];
						formatted_stop['stop_id'] = json_stop['StopId'];
						formatted_stop['stop_ref'] = json_stop['StopRef'];
						formatted_stop['irish_short_name'] = json_stop['AltStopNameShort'];
						formatted_stop['irish_long_name'] = json_stop['AltStopNameLong'];
						formatted_stop['latitude'] = json_stop['Latitude'];
						formatted_stop['longitude'] = json_stop['Longitude'];
						
						formatted_stops.push(formatted_stop);
					});
					
					response_string = JSON.stringify(formatted_stops);
					
					if (response_string.length > 0) {
						global.stops_json_string = response_string;
						global.formatted_stops = formatted_stops;
						
						// Refresh the cache every 24 hours
						var expiry_date = new Date();
						expiry_date.setDate(expiry_date.getDate() + 1);
						global.stops_timestamp = expiry_date;
						code = 200;
					}
				}
			}
		}
		
		if (!response_string) {
			response_string = '{\"error\" : \"An error occurred.\", \"code\" : 500}';
		}
		
		res.send(code, response_string);
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
					
					
					// Call the RTPI API to retrieve the latest departure times at that stop.
					// We actually scrape the mobile/text-only website here, as there doesn't
					// seem to be a visible API that allows us to do similar.
					
					var url = 'http://rtpi.ie/Text/WebDisplay.aspx?stopRef=' + stop_ref;
					
					request(url, function(error, response, body) {
						
						if (!error) {
							
							// Load the response body/HTML into Cheerio for parsing.
							var $ = cheerio.load(body);
							
							var times = [];
							
							
							// Find the times <table> and loop through each <tr>.
							
							$("table.webDisplayTable tr").each(function(tr_index, tr) { 
								
								var time = new Object();
								
								var td_array = $(this).find("td"); 

								if (td_array.length > 0) {
									
									// Each <tr> holds the following data: 
									// <td>timetable_id</td> <td>display_name</td> <td>depart_timestamp</td> <td>&nbsp;</td>
									
									// Loop through each <td> and extract the data.
									
									td_array.each(function(td_index, td) {
										
										var value = td.children[0].data;
										
										if (!time['timetable_id']) {
											time['timetable_id'] = value;
										}
										else if (!time['display_name']) {
											time['display_name'] = value;
										}
										else if (!time['depart_timestamp']) {
											
											var nowDateTime = new Date();
											var now = nowDateTime.getTime();
											
											
											// The timestamp can be in three different formats: Due, X Mins, HH:mm.
											
											if (value == 'Due') {
												time['depart_timestamp'] = now;
											}
											else {
												
												if (value.indexOf('Min') != -1) {
													var remaining_mins = parseInt(value.replace('Mins', '').replace('Min', ''));
													time['depart_timestamp'] = new Date(nowDateTime.getTime() + remaining_mins*60000);
												}
												else {
													
													var t = value.split(':');  
													
													nowDateTime.setHours(+t[0]);
													nowDateTime.setMinutes(t[1]);
													
													time['depart_timestamp'] = nowDateTime;
												}
												
												times.push(time);
											}
										}
										
									});
								}								
								
								
							});
							
							// Store the times for API response.
							stop['times'] = times;
							
							response_string = JSON.stringify(stop);
							code = 200;
						}
						
						if (!response_string) {
							response_string = '{\"error\" : \"An error occurred.\", \"code\" : 500}';
						}
						
						res.send(code, response_string);
						
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
	
	res.send(code, response_string);
	
});

app.use('/', express.static(__dirname + '/public'));

// 404
app.get('*', function(req, res){
  res.send(404, '{\"error\" : \"An error occurred.\", \"code\" : 404}');
});


// Set up the server
app.listen(port);
exports = module.exports = app;
global.init_cache();
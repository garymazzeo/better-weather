<?php
declare(strict_types=1);

require __DIR__ . '/nws_lib.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    better_weather_json_error(405, 'Method not allowed');
    exit;
}

$latRaw = $_GET['lat'] ?? null;
$lonRaw = $_GET['lon'] ?? null;

if ($latRaw === null || $lonRaw === null || $latRaw === '' || $lonRaw === '') {
    better_weather_json_error(400, 'Missing lat or lon');
    exit;
}

if (!is_numeric($latRaw) || !is_numeric($lonRaw)) {
    better_weather_json_error(400, 'lat and lon must be numbers');
    exit;
}

$lat = round((float) $latRaw, 4);
$lon = round((float) $lonRaw, 4);

if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
    better_weather_json_error(400, 'lat or lon out of range');
    exit;
}

// NWS allows at most four decimal places
$latStr = number_format($lat, 4, '.', '');
$lonStr = number_format($lon, 4, '.', '');

$url = 'https://api.weather.gov/points/' . rawurlencode($latStr) . ',' . rawurlencode($lonStr);

$result = better_weather_nws_request($url);

if (!$result['ok']) {
    $msg = 'NWS request failed';
    if ($result['status'] === 404) {
        $msg = 'No forecast for this location (NWS covers U.S. locations)';
    }
    better_weather_json_error($result['status'] >= 400 ? $result['status'] : 502, $msg);
    exit;
}

$data = json_decode($result['body'], true);
if (!is_array($data)) {
    better_weather_json_error(502, 'Invalid JSON from NWS');
    exit;
}

echo json_encode($data, JSON_UNESCAPED_UNICODE);

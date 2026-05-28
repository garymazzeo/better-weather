<?php
declare(strict_types=1);

require __DIR__ . '/nws_lib.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    better_weather_json_error(405, 'Method not allowed');
    exit;
}

$raw = $_GET['url'] ?? '';
if ($raw === '') {
    better_weather_json_error(400, 'Missing url');
    exit;
}

$url = rawurldecode($raw);
if ($url === '') {
    better_weather_json_error(400, 'Invalid url');
    exit;
}

$parts = parse_url($url);
if ($parts === false || empty($parts['scheme']) || empty($parts['host']) || empty($parts['path'])) {
    better_weather_json_error(400, 'Could not parse url');
    exit;
}

$scheme = strtolower($parts['scheme']);
$host = strtolower($parts['host']);
$path = $parts['path'];

if ($scheme !== 'https' || $host !== 'api.weather.gov') {
    better_weather_json_error(400, 'Only https://api.weather.gov URLs are allowed');
    exit;
}

// Allowlist path prefixes (forecast + point metadata + text products)
if (
    !preg_match('#^/(points|gridpoints|stations|products)/#', $path)
) {
    better_weather_json_error(400, 'Path not allowed');
    exit;
}

$result = better_weather_nws_request($url);

if (!$result['ok']) {
    $msg = 'NWS request failed';
    better_weather_json_error($result['status'] >= 400 ? $result['status'] : 502, $msg);
    exit;
}

$data = json_decode($result['body'], true);
if (!is_array($data)) {
    better_weather_json_error(502, 'Invalid JSON from NWS');
    exit;
}

echo json_encode($data, JSON_UNESCAPED_UNICODE);

<?php
declare(strict_types=1);

require __DIR__ . '/nws_lib.php';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    better_weather_json_error(405, 'Method not allowed');
    exit;
}

$zip = trim((string) ($_GET['zip'] ?? ''));
$city = trim((string) ($_GET['city'] ?? ''));
$state = trim((string) ($_GET['state'] ?? ''));

if ($zip !== '') {
    if (!preg_match('/^\d{5}(-\d{4})?$/', $zip)) {
        better_weather_json_error(400, 'Invalid ZIP code');
        exit;
    }
    if ($city !== '' || $state !== '') {
        better_weather_json_error(400, 'Provide either a ZIP code or city and state, not both');
        exit;
    }
    geocode_zip($zip);
    exit;
}

if ($city !== '' || $state !== '') {
    if ($city === '' || $state === '') {
        better_weather_json_error(400, 'Enter both city and state');
        exit;
    }
    if (!preg_match('/^[A-Za-z]{2}$/', $state)) {
        better_weather_json_error(400, 'State must be a two-letter code (e.g. WA)');
        exit;
    }
    geocode_city_state($city, strtoupper($state));
    exit;
}

better_weather_json_error(400, 'Provide a ZIP code or city and state');

/**
 * @return array{ok: bool, status: int, body: string}
 */
function better_weather_http_get(string $url, array $headers = []): array
{
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 500, 'body' => ''];
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers,
    ]);

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($body === false) {
        return ['ok' => false, 'status' => 502, 'body' => ''];
    }

    return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'body' => $body];
}

function geocode_zip(string $zip): void
{
    $zip5 = substr($zip, 0, 5);
    $url = 'https://api.zippopotam.us/us/' . rawurlencode($zip5);
    $result = better_weather_http_get($url);

    if (!$result['ok']) {
        if ($result['status'] === 404) {
            better_weather_json_error(404, 'No match for that ZIP code');
            return;
        }
        better_weather_json_error(502, 'ZIP lookup failed');
        return;
    }

    $data = json_decode($result['body'], true);
    if (!is_array($data)) {
        better_weather_json_error(502, 'Invalid JSON from ZIP lookup');
        return;
    }

    $places = $data['places'] ?? null;
    if (!is_array($places) || count($places) === 0) {
        better_weather_json_error(404, 'No match for that ZIP code');
        return;
    }

    $place = $places[0];
    if (!isset($place['latitude'], $place['longitude'])) {
        better_weather_json_error(502, 'ZIP lookup returned no coordinates');
        return;
    }

    $lat = round((float) $place['latitude'], 4);
    $lon = round((float) $place['longitude'], 4);
    $name = (string) ($place['place name'] ?? '');
    $st = (string) ($place['state abbreviation'] ?? '');
    $label = trim($name . ($name && $st ? ', ' : '') . $st);
    if ($label === '') {
        $label = $zip5;
    }

    echo json_encode([
        'lat' => $lat,
        'lon' => $lon,
        'matchedAddress' => $label . ' ' . $zip5,
    ], JSON_UNESCAPED_UNICODE);
}

function geocode_city_state(string $city, string $state): void
{
    $query = $city . ', ' . $state . ', USA';
    $url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
        'format' => 'json',
        'limit' => 1,
        'countrycodes' => 'us',
        'q' => $query,
    ]);

    $result = better_weather_http_get($url, [
        'Accept: application/json',
        'User-Agent: ' . BETTER_WEATHER_UA,
    ]);

    if (!$result['ok']) {
        better_weather_json_error(502, 'City lookup failed');
        return;
    }

    $data = json_decode($result['body'], true);
    if (!is_array($data) || count($data) === 0) {
        better_weather_json_error(404, 'No match for that city and state');
        return;
    }

    $first = $data[0];
    if (!isset($first['lat'], $first['lon'])) {
        better_weather_json_error(502, 'City lookup returned no coordinates');
        return;
    }

    $lat = round((float) $first['lat'], 4);
    $lon = round((float) $first['lon'], 4);

    echo json_encode([
        'lat' => $lat,
        'lon' => $lon,
        'matchedAddress' => $first['display_name'] ?? $query,
    ], JSON_UNESCAPED_UNICODE);
}

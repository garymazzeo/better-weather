<?php
/**
 * Shared NWS proxy helpers.
 */

define('BETTER_WEATHER_UA', 'BetterWeather/1.0 (https://github.com/garymazzeo/better-weather; local-dev)');

/**
 * Fetch a URL from api.weather.gov with required User-Agent.
 *
 * @return array{ok: bool, status: int, body: string, content_type: string|null}
 */
function better_weather_nws_request(string $url): array
{
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 500, 'body' => '', 'content_type' => null];
    }

    $ch = curl_init($url);
    $curlErr = '';
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'Accept: application/geo+json',
            'User-Agent: ' . BETTER_WEATHER_UA,
        ],
    ]);

    $body = curl_exec($ch);
    if ($body === false) {
        $curlErr = (string) curl_error($ch);
    }
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    // Minimal debug logging to Cursor NDJSON file (no secrets).
    // This stays until we confirm the fix with runtime logs.
    $logPath = __DIR__ . '/../.cursor/debug-b93505.log';
    @file_put_contents($logPath, json_encode([
        'sessionId' => 'b93505',
        'runId' => 'pre-fix',
        'hypothesisId' => 'H1',
        'location' => 'api/nws_lib.php:better_weather_nws_request',
        'message' => 'NWS proxy response',
        'data' => [
            'url' => $url,
            'status' => $status,
            'content_type' => $ctype,
            'curl_error' => $curlErr !== '' ? $curlErr : null,
            'body_prefix' => is_string($body) ? substr($body, 0, 180) : null,
        ],
        'timestamp' => (int) floor(microtime(true) * 1000),
    ], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);

    if ($body === false) {
        return ['ok' => false, 'status' => 502, 'body' => '', 'content_type' => null];
    }

    return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'body' => $body, 'content_type' => $ctype];
}

function better_weather_json_error(int $httpStatus, string $message): void
{
    http_response_code($httpStatus);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
}

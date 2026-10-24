<?php
declare(strict_types=1);

/**
 * Minimal router for `php -S` — polyfills CLI-only helpers, forwards to candidate code.
 * Schema/seed is applied once at container boot (see boot-http-service.sh), not here.
 */
if (PHP_SAPI === 'cli-server') {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    if ($path === '/.well-known/assessment-health') {
        http_response_code(204);
        exit;
    }
}

/**
 * Merge query params from the assessment harness (request.json) into superglobals.
 * Ensures $_GET is populated even when the built-in server router omits query parsing.
 */
if (is_file(__DIR__ . '/request.json')) {
    $assessmentRequest = json_decode((string) file_get_contents(__DIR__ . '/request.json'), true);
    if (is_array($assessmentRequest)) {
        $routePath = (string) ($assessmentRequest['path'] ?? '/');
        $queryParams = [];

        if (!empty($assessmentRequest['query']) && is_array($assessmentRequest['query'])) {
            foreach ($assessmentRequest['query'] as $key => $value) {
                if (is_string($key) || is_int($key)) {
                    $queryParams[(string) $key] = (string) $value;
                }
            }
        }

        $qPos = strpos($routePath, '?');
        if ($qPos !== false) {
            $embeddedQuery = substr($routePath, $qPos + 1);
            $routePath = substr($routePath, 0, $qPos) ?: '/';
            $parsed = [];
            parse_str($embeddedQuery, $parsed);
            if (is_array($parsed)) {
                foreach ($parsed as $key => $value) {
                    if (is_string($key) && (is_string($value) || is_int($value) || is_float($value))) {
                        $queryParams[$key] = (string) $value;
                    }
                }
            }
        }

        if ($queryParams !== []) {
            foreach ($queryParams as $key => $value) {
                $_GET[$key] = $value;
                $_REQUEST[$key] = $value;
            }
            $_SERVER['QUERY_STRING'] = http_build_query($queryParams);
            $_SERVER['REQUEST_URI'] = $routePath . '?' . $_SERVER['QUERY_STRING'];
            if (!empty($assessmentRequest['method'])) {
                $_SERVER['REQUEST_METHOD'] = strtoupper((string) $assessmentRequest['method']);
            }
        }
    }
}

if (!function_exists('getallheaders')) {
    function getallheaders(): array
    {
        $headers = [];
        foreach ($_SERVER as $name => $value) {
            if (!is_string($name) || !is_string($value)) {
                continue;
            }
            if (str_starts_with($name, 'HTTP_')) {
                $key = str_replace(
                    ' ',
                    '-',
                    ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))),
                );
                $headers[$key] = $value;
            }
        }
        return $headers;
    }
}

if (!defined('STDIN')) {
    $stdinContent = '';
    if (is_file(__DIR__ . '/test-input.txt')) {
        $stdinContent = (string) file_get_contents(__DIR__ . '/test-input.txt');
    } else {
        $rawInput = file_get_contents('php://input');
        if (is_string($rawInput) && $rawInput !== '') {
            $stdinContent = $rawInput;
        } elseif (!empty($_GET)) {
            $stdinContent = count($_GET) === 1
                ? (string) reset($_GET)
                : http_build_query($_GET);
        } elseif (is_file(__DIR__ . '/request.json')) {
            $payload = json_decode((string) file_get_contents(__DIR__ . '/request.json'), true);
            if (is_array($payload)) {
                $method = $payload['method'] ?? 'POST';
                $path = $payload['path'] ?? '/';
                if (array_key_exists('body', $payload)) {
                    $stdinContent = json_encode(
                        [
                            'method' => $method,
                            'path' => $path,
                            'body' => $payload['body'],
                        ],
                        JSON_UNESCAPED_UNICODE,
                    );
                } elseif (!empty($payload['query']) && is_array($payload['query'])) {
                    $query = $payload['query'];
                    $stdinContent = count($query) === 1
                        ? (string) reset($query)
                        : http_build_query($query);
                }
            }
        }
    }

    $stdinStream = fopen('php://memory', 'rb+');
    if ($stdinStream === false) {
        define('STDIN', fopen('php://input', 'r'));
    } else {
        fwrite($stdinStream, $stdinContent);
        rewind($stdinStream);
        define('STDIN', $stdinStream);
    }
}

if (!defined('STDOUT')) {
    define('STDOUT', fopen('php://output', 'w'));
}

if (!defined('STDERR')) {
    define('STDERR', fopen('php://stderr', 'w'));
}

$target = __DIR__ . '/Main.php';
if (!is_file($target)) {
    $target = __DIR__ . '/index.php';
}

require $target;

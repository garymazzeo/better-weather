# Better Weather

Minimal static front-end (HTML/CSS/vanilla JavaScript) with **Chart.js**, backed by a small **PHP** proxy to the [National Weather Service API](https://www.weather.gov/documentation/services-web-api). Forecasts cover roughly the **next seven days** (hourly + 12-hour periods).

## Requirements

- **PHP 8+** with the **curl** extension (`php -m | grep curl`)
- **Node.js** (optional, only to install or update Chart.js into `js/vendor/`)

## Local development

From the project root:

```bash
npm install
npm run serve
```

Open `http://127.0.0.1:8080/`. The PHP server serves `index.html` and `/api/*.php` on the same origin so `fetch` works without a separate proxy.

Use **Use my location** (HTTPS or localhost) or enter **latitude** and **longitude**, then **Load forecast**.

## Deployment

Build is the repo itself: deploy `index.html`, `css/`, `js/` (including `js/vendor/chart.umd.min.js`), and `api/*.php` to a host that runs PHP (Apache, nginx + php-fpm, etc.) with the document root pointing at this tree.

## License

ISC (see `package.json`).

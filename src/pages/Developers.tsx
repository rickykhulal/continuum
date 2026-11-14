// Developer Portal — multi-language API examples for the Continuum public API.
import { useState, useCallback } from 'react';
import { useStore } from '../lib/store';
import { PageHeader } from './Community';

const BASE_URL = 'https://continuum-6ofw.onrender.com/api/v1';

const snippets: Record<string, string> = {
  javascript: `// Web (JavaScript / Fetch)
fetch('${BASE_URL}/live-fires?region_id=country-kenya')
  .then((r) => r.json())
  .then((data) => console.log(data))
  .catch((err) => console.error(err));`,

  python: `# Python (Requests)
import requests

url = '${BASE_URL}/live-fires'
params = {'region_id': 'country-kenya'}
resp = requests.get(url, params=params)
resp.raise_for_status()
print(resp.json())`,

  curl: `# cURL
curl -G '${BASE_URL}/live-fires' \\
  -d 'region_id=country-kenya'`,

  csharp: `// C# (HttpClient)
using System.Net.Http.Json;
using System.Threading.Tasks;

var client = new HttpClient();
var url = "${BASE_URL}/live-fires?region_id=country-kenya";
var data = await client.GetFromJsonAsync<JsonElement>(url);
Console.WriteLine(data);`,

  php: `<?php
// PHP (cURL)
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, '${BASE_URL}/live-fires?region_id=country-kenya');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
echo $response;`,

  cpp: `// C++ (libcurl)
#include <curl/curl.h>
#include <iostream>
#include <string>

static size_t WriteCb(void* ptr, size_t size, size_t nmemb, std::string* s) {
  s->append((char*)ptr, size * nmemb);
  return size * nmemb;
}

int main() {
  CURL* curl = curl_easy_init();
  if (!curl) return 1;
  std::string url = "${BASE_URL}/live-fires?region_id=country-kenya";
  std::string readBuffer;
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCb);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &readBuffer);
  CURLcode res = curl_easy_perform(curl);
  if (res != CURLE_OK) {
    std::cerr << curl_easy_strerror(res) << std::endl;
    return 1;
  }
  std::cout << readBuffer << std::endl;
  curl_easy_cleanup(curl);
  return 0;
}`,
};

const LANGUAGES = [
  { id: 'javascript', label: 'JavaScript (Fetch)' },
  { id: 'python', label: 'Python (Requests)' },
  { id: 'curl', label: 'cURL' },
  { id: 'csharp', label: 'C# (HttpClient)' },
  { id: 'php', label: 'PHP (cURL)' },
  { id: 'cpp', label: 'C++ (libcurl)' },
];

const endpoints = [
  { method: 'GET', path: '/health', desc: 'Liveness check — returns ok status.' },
  { method: 'GET', path: '/trend', desc: 'Harmonized historical data for a given area.' },
  { method: 'GET', path: '/live-fires', desc: 'Live fire detections for a region or area.' },
  { method: 'GET', path: '/community/feed', desc: 'Community posts and verified announcements.' },
];

export function Developers() {
  const store = useStore();
  const [activeLang, setActiveLang] = useState('javascript');
  const t = (key: string) => store.t(key as never);

  return (
    <section className="page developers-page" aria-label="Developer Portal">
      <PageHeader
        eyebrow="Developer Portal"
        title="Continuum Public API"
        intro={
          <>
            Build with harmonized satellite data. The public API serves sensor-harmonized
            burning activity for pilot regions, country borders, and any circle or polygon
            area on Earth.{' '}
            <a href="/openapi.json" className="feed-link" target="_blank" rel="noreferrer">
              OpenAPI spec
            </a>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => store.setView('watch')}
            >
              ← Orbital Watch
            </button>
          </>
        }
      />

      <div className="dev-base">
        <span className="dev-base-label">Base URL</span>
        <code className="dev-base-url">{BASE_URL}</code>
      </div>

      <section className="dev-endpoints">
        <h2 className="dev-section-title">Endpoints</h2>
        <table className="dev-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.path}>
                <td>
                  <span className={`dev-method ${ep.method.toLowerCase()}`}>{ep.method}</span>
                </td>
                <td><code>{ep.path}</code></td>
                <td>{ep.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="dev-snippets">
        <h2 className="dev-section-title">Code Snippets — GET /api/v1/live-fires</h2>
        <div className="dev-tabs">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              type="button"
              className={`dev-tab ${activeLang === lang.id ? 'active' : ''}`}
              onClick={() => setActiveLang(lang.id)}
            >
              {lang.label}
            </button>
          ))}
        </div>
        <pre className="dev-code"><code>{snippets[activeLang]}</code></pre>
      </section>
    </section>
  );
}

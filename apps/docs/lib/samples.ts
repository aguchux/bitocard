import { apiBase, type Operation, requestExample } from "./openapi";

export type Language = "curl" | "node" | "python" | "php";
export const languages: Array<{ id: Language; label: string; shiki: string }> = [
  { id: "curl", label: "cURL", shiki: "bash" },
  { id: "node", label: "Node.js", shiki: "javascript" },
  { id: "python", label: "Python", shiki: "python" },
  { id: "php", label: "PHP", shiki: "php" },
];

/** Path parameters filled from their documented examples, else a readable placeholder. */
export function examplePath(operation: Operation) {
  return operation.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const parameter = operation.parameters.find(item => item.in === "path" && item.name === name);
    const example = parameter?.example ?? parameter?.schema?.example;
    return example !== undefined ? encodeURIComponent(String(example)) : name === "id" ? "5f0c6a8e-3b1d-4c9a-9e2f-7a1b2c3d4e5f" : `{${name}}`;
  });
}

/** Required query parameters (and documented examples) as `?a=b`. */
export function exampleQuery(operation: Operation) {
  const query = operation.parameters
    .filter(item => item.in === "query" && (item.required || item.example !== undefined || item.schema?.example !== undefined))
    .map(item => [item.name, String(item.example ?? item.schema?.example ?? "")] as const)
    .filter(([, value]) => value !== "");
  return query.length ? `?${new URLSearchParams(query as Array<[string, string]>).toString()}` : "";
}

const json = (value: unknown, indent = 2) => JSON.stringify(value, null, indent);
const pad = (text: string, spaces: number) => text.replace(/\n/g, `\n${" ".repeat(spaces)}`);

/** Python literal for a JSON value (True, False, None). */
function python(value: unknown, depth = 0): string {
  const indent = "    ".repeat(depth + 1);
  const close = "    ".repeat(depth);
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (Array.isArray(value)) return value.length ? `[\n${value.map(item => `${indent}${python(item, depth + 1)}`).join(",\n")},\n${close}]` : "[]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? `{\n${entries.map(([key, item]) => `${indent}${JSON.stringify(key)}: ${python(item, depth + 1)}`).join(",\n")},\n${close}}` : "{}";
  }
  return JSON.stringify(value);
}

/** PHP array literal for a JSON value. */
function php(value: unknown, depth = 0): string {
  const indent = "    ".repeat(depth + 1);
  const close = "    ".repeat(depth);
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return value.length ? `[\n${value.map(item => `${indent}${php(item, depth + 1)}`).join(",\n")},\n${close}]` : "[]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? `[\n${entries.map(([key, item]) => `${indent}'${key}' => ${php(item, depth + 1)}`).join(",\n")},\n${close}]` : "[]";
  }
  return String(value);
}

/**
 * Ready-to-run code for one operation. Keys come from an environment variable (never pasted into code), every POST
 * sends a fresh Idempotency-Key, and dashboard-only operations say so instead of showing a key.
 */
export function codeSamples(operation: Operation): Record<Language, string> {
  const url = `${apiBase}${examplePath(operation)}${exampleQuery(operation)}`;
  const method = operation.method.toUpperCase();
  const body = requestExample(operation);
  const hasBody = body !== undefined && operation.method !== "get" && operation.method !== "delete";
  const post = operation.method === "post";
  const authed = operation.auth === "api_key";
  const sessionNote = "Dashboard only: SHQ calls this with its signed-in session; API keys cannot.";

  const curl = [
    `curl${method === "GET" ? "" : ` -X ${method}`} "${url}"`,
    ...(authed ? [`  -H "Authorization: Bearer $BITOCARD_API_KEY"`] : []),
    ...(post ? [`  -H "Idempotency-Key: $(uuidgen)"`] : []),
    ...(hasBody ? [`  -H "Content-Type: application/json"`, `  -d '${json(body).replace(/'/g, "'\\''")}'`] : []),
  ].join(" \\\n");

  const nodeHeaders = [
    ...(authed ? ["Authorization: `Bearer ${process.env.BITOCARD_API_KEY}`"] : []),
    ...(post ? ['"Idempotency-Key": crypto.randomUUID()'] : []),
    ...(hasBody ? ['"Content-Type": "application/json"'] : []),
  ];
  const node = [
    ...(operation.auth === "session" ? [`// ${sessionNote}`] : []),
    `const response = await fetch("${url}", {`,
    ...(method !== "GET" ? [`  method: "${method}",`] : []),
    ...(nodeHeaders.length ? [`  headers: {\n    ${nodeHeaders.join(",\n    ")},\n  },`] : []),
    ...(hasBody ? [`  body: JSON.stringify(${pad(json(body), 2)}),`] : []),
    `});`,
    `const data = await response.json();`,
    `if (!response.ok) throw new Error(\`\${data.error.code}: \${data.error.message}\`);`,
    `console.log(data);`,
  ].join("\n");

  const pyHeaders = [
    ...(authed ? ['"Authorization": f"Bearer {os.environ[\'BITOCARD_API_KEY\']}"'] : []),
    ...(post ? ['"Idempotency-Key": str(uuid.uuid4())'] : []),
  ];
  const pythonCode = [
    ...(operation.auth === "session" ? [`# ${sessionNote}`] : []),
    ["import os", ...(post ? ["import uuid"] : []), "", "import requests"].join("\n"),
    "",
    `response = requests.${operation.method}(`,
    `    "${url}",`,
    ...(pyHeaders.length ? [`    headers={\n        ${pyHeaders.join(",\n        ")},\n    },`] : []),
    ...(hasBody ? [`    json=${pad(python(body, 1), 0)},`] : []),
    "    timeout=30,",
    ")",
    "data = response.json()",
    "if not response.ok:",
    '    raise RuntimeError(f"{data[\'error\'][\'code\']}: {data[\'error\'][\'message\']}")',
    "print(data)",
  ].join("\n");

  const phpHeaders = [
    ...(authed ? ["'Authorization' => 'Bearer ' . getenv('BITOCARD_API_KEY')"] : []),
    ...(post ? ["'Idempotency-Key' => bin2hex(random_bytes(16))"] : []),
  ];
  const phpCode = [
    "<?php",
    ...(operation.auth === "session" ? [`// ${sessionNote}`] : []),
    "// composer require guzzlehttp/guzzle",
    "$client = new \\GuzzleHttp\\Client(['http_errors' => false, 'timeout' => 30]);",
    "",
    `$response = $client->request('${method}', '${url}', [`,
    ...(phpHeaders.length ? [`    'headers' => [\n        ${phpHeaders.join(",\n        ")},\n    ],`] : []),
    ...(hasBody ? [`    'json' => ${php(body, 1)},`] : []),
    "]);",
    "$data = json_decode((string) $response->getBody(), true);",
    "if ($response->getStatusCode() >= 400) {",
    "    throw new RuntimeException($data['error']['code'] . ': ' . $data['error']['message']);",
    "}",
    "print_r($data);",
  ].join("\n");

  return { curl, node, python: pythonCode, php: phpCode };
}

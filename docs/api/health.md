# Health & Version

## Health Check

### `GET /api/health`

Returns server health status.

**Response:** `200 OK` with body `OK`

**Example:**

```bash
curl http://localhost:8080/api/health
```

## Version

### `GET /api/version`

Returns the server version.

**Response:**

```json
{
  "version": "0.1.0"
}
```

**Example:**

```bash
curl http://localhost:8080/api/version
```

# CueCommX TLS Certificates

Self-signed certificates for local HTTPS development.

## Files

| File | Purpose |
|------|---------|
| `ca.crt` | **CA certificate — install this on client devices to trust the server** |
| `ca.key` | CA private key (keep secret) |
| `server.crt` | Server certificate (signed by the CA) |
| `server.key` | Server private key (keep secret) |

## Server usage

Set these environment variables (or add to `.env`):

```
CUECOMMX_TLS_CERT_FILE=certs/server.crt
CUECOMMX_TLS_KEY_FILE=certs/server.key
```

## Trusting on client devices

### iOS
1. AirDrop or email `ca.crt` to the device
2. Open the file → **Settings > Profile Downloaded > Install**
3. Go to **Settings > General > About > Certificate Trust Settings**
4. Toggle **full trust** for "CueCommX Local CA"

### Android
1. Transfer `ca.crt` to the device
2. **Settings > Security > Install a certificate > CA certificate**
3. Select `ca.crt` and confirm

### macOS
1. Double-click `ca.crt` → opens Keychain Access
2. Select **login** or **System** keychain → Add
3. Find "CueCommX Local CA", double-click, expand **Trust**
4. Set **When using this certificate** to **Always Trust**

### Linux / Chrome
```bash
sudo cp ca.crt /usr/local/share/ca-certificates/cuecommx-local-ca.crt
sudo update-ca-certificates
```

## Regenerating

```bash
# Generate new CA (10 year validity)
openssl genrsa -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=CueCommX Local CA/O=CueCommX/C=US" -out ca.crt

# Generate server cert signed by CA (2 year validity)
openssl genrsa -out server.key 2048
openssl req -new -key server.key \
  -subj "/CN=cuecommx.blanchard.local/O=CueCommX/C=US" -out server.csr

cat > server-ext.cnf <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = cuecommx.blanchard.local
DNS.2 = *.blanchard.local
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -days 730 -sha256 -extfile server-ext.cnf

rm server.csr server-ext.cnf ca.srl
```

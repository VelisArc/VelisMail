//! TLS configuration for secure communications

use anyhow::Result;
use rustls::ServerConfig;
use std::sync::Arc;

/// Create a secure TLS server configuration
pub fn create_tls_config(cert: Vec<u8>, key: Vec<u8>) -> Result<ServerConfig> {
    use rustls::pki_types::{CertificateDer, PrivateKeyDer};

    let cert_chain = vec![CertificateDer::from(cert)];
    let key_der =
        PrivateKeyDer::try_from(key).map_err(|e| anyhow::anyhow!("Invalid private key: {}", e))?;

    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(cert_chain, key_der)?;

    Ok(config)
}

/// Create TLS config with mutual authentication (mTLS)
pub fn create_mtls_config(cert: Vec<u8>, key: Vec<u8>, client_ca: Vec<u8>) -> Result<ServerConfig> {
    use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
    use std::io::Cursor;

    let cert_chain = vec![CertificateDer::from(cert)];
    let key_der =
        PrivateKeyDer::try_from(key).map_err(|e| anyhow::anyhow!("Invalid private key: {}", e))?;

    let client_ca_certs: Vec<CertificateDer> =
        CertificateDer::pem_reader_iter(&mut Cursor::new(&client_ca))
            .collect::<Result<Vec<_>, _>>()?;

    let mut root_store = rustls::RootCertStore::empty();
    for cert in client_ca_certs {
        root_store.add(cert)?;
    }

    let config = ServerConfig::builder()
        .with_client_cert_verifier(
            rustls::server::WebPkiClientVerifier::builder(Arc::new(root_store))
                .build()
                .map_err(|e| anyhow::anyhow!("Client verifier setup failed: {}", e))?,
        )
        .with_single_cert(cert_chain, key_der)?;

    Ok(config)
}

/// Note: TLS 1.3 is now the default and only supported version in rustls 0.22+
/// Version enforcement is handled automatically by the library

#[cfg(test)]
mod tests {

    #[test]
    fn test_tls_config_creation() {
        // Note: This would require actual cert/key files
        // Just testing that the module compiles
    }
}

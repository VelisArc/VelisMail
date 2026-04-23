//! S3 client wrapper

use anyhow::Result;
use aws_config::BehaviorVersion;
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;

/// S3 client for object storage
pub struct S3Client {
    client: Client,
    bucket: String,
    public_base_url: String,
}

impl S3Client {
    pub async fn new(
        endpoint: &str,
        region: &str,
        access_key: &str,
        secret_key: &str,
        bucket: &str,
    ) -> Result<Self> {
        let region = Region::new(region.to_string());
        let mut loader = aws_config::defaults(BehaviorVersion::latest()).region(region.clone());

        if !access_key.trim().is_empty() && !secret_key.trim().is_empty() {
            loader = loader.credentials_provider(Credentials::new(
                access_key.trim(),
                secret_key.trim(),
                None,
                None,
                "velismail-storage",
            ));
        }

        let shared_config = loader.load().await;
        let mut config_builder = aws_sdk_s3::config::Builder::from(&shared_config).region(region);

        if !endpoint.trim().is_empty() {
            config_builder = config_builder
                .endpoint_url(endpoint.trim())
                .force_path_style(true);
        }

        let client = Client::from_conf(config_builder.build());
        let public_base_url = if endpoint.trim().is_empty() {
            "https://storage.velismail.online".to_string()
        } else {
            endpoint.trim_end_matches('/').to_string()
        };

        Ok(Self {
            client,
            bucket: bucket.to_string(),
            public_base_url,
        })
    }

    /// Upload an object
    pub async fn upload_object(&self, key: &str, data: Vec<u8>, content_type: &str) -> Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(ByteStream::from(data))
            .content_type(content_type)
            .send()
            .await?;

        Ok(())
    }

    /// Download an object
    pub async fn download_object(&self, key: &str) -> Result<Vec<u8>> {
        let resp = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;

        let bytes = resp.body.collect().await?.into_bytes();
        Ok(bytes.to_vec())
    }

    /// Delete an object
    pub async fn delete_object(&self, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;

        Ok(())
    }

    /// Generate a presigned URL
    pub async fn presigned_url(&self, key: &str, expires_in_secs: u64) -> Result<String> {
        // In production, use presigning
        let _ = expires_in_secs;
        Ok(format!(
            "{}/{}/{}",
            self.public_base_url, self.bucket, key
        ))
    }

    /// Get object metadata
    pub async fn get_object_size(&self, key: &str) -> Result<i64> {
        let resp = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await?;

        Ok(resp.content_length.unwrap_or(0))
    }
}

//! S3 client wrapper

use anyhow::Result;
use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::{Client, Error as S3Error};

/// S3 client for object storage
pub struct S3Client {
    client: Client,
    bucket: String,
}

impl S3Client {
    pub async fn new(
        endpoint: &str,
        region: &str,
        access_key: &str,
        secret_key: &str,
        bucket: &str,
    ) -> Result<Self> {
        // Create SDK config
        let sdk_config = aws_config::defaults(BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new(region.to_string()))
            .load()
            .await;

        let client = Client::new(&sdk_config);

        Ok(Self {
            client,
            bucket: bucket.to_string(),
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
            "https://storage.velismail.online", self.bucket, key
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

//! Local filesystem storage backend.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use tokio::fs;

/// Stores encrypted objects on the local VM filesystem.
pub struct LocalStorage {
    root: PathBuf,
}

impl LocalStorage {
    pub fn new(root: &str) -> Result<Self> {
        let root = PathBuf::from(root);
        std::fs::create_dir_all(&root)
            .with_context(|| format!("failed to create storage root {}", root.display()))?;
        Ok(Self { root })
    }

    fn safe_path(&self, key: &str) -> Result<PathBuf> {
        if key.trim().is_empty() || key.contains("..") || Path::new(key).is_absolute() {
            bail!("invalid storage key: {key}");
        }

        let path = self.root.join(key);
        let canonical_root = self
            .root
            .canonicalize()
            .unwrap_or_else(|_| self.root.clone());
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let canonical_path = path.canonicalize().unwrap_or_else(|_| path.clone());
        if !canonical_path.starts_with(&canonical_root) {
            bail!("storage key escapes storage root: {key}");
        }
        Ok(path)
    }

    pub async fn upload_object(&self, key: &str, data: Vec<u8>, _content_type: &str) -> Result<()> {
        let path = self.safe_path(key)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(path, data).await?;
        Ok(())
    }

    pub async fn download_object(&self, key: &str) -> Result<Vec<u8>> {
        let path = self.safe_path(key)?;
        Ok(fs::read(path).await?)
    }

    pub async fn delete_object(&self, key: &str) -> Result<()> {
        let path = self.safe_path(key)?;
        if path.exists() {
            fs::remove_file(path).await?;
        }
        Ok(())
    }

    pub async fn get_object_size(&self, key: &str) -> Result<i64> {
        let path = self.safe_path(key)?;
        let metadata = fs::metadata(path).await?;
        Ok(metadata.len() as i64)
    }

    pub async fn is_healthy(&self) -> bool {
        let probe = self.root.join(".health");
        fs::write(&probe, b"ok").await.is_ok() && fs::remove_file(&probe).await.is_ok()
    }
}

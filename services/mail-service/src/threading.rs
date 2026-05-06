#![allow(dead_code)]
//! Email threading and organization logic
//!
//! Implements email threading algorithms, conversation grouping,
//! and nested folder/label management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
use velismail_common::FolderType;

/// Email thread representing a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailThread {
    pub id: Uuid,
    pub subject: String,
    pub normalized_subject: String,
    pub participants: Vec<String>,
    pub message_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub last_message_at: DateTime<Utc>,
    pub message_count: usize,
    pub unread_count: usize,
    pub is_starred: bool,
}

/// Message metadata for threading
#[derive(Debug, Clone)]
pub struct MessageThreadingMetadata {
    pub message_id: String,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub subject: String,
    pub from: String,
}

/// Thread matching result
#[derive(Debug, Clone)]
pub struct ThreadMatchResult {
    pub thread_id: Uuid,
    pub confidence: f32,
    pub reason: String,
}

/// Threading engine for grouping emails into conversations
pub struct ThreadingEngine {
    thread_cache: HashMap<Uuid, EmailThread>,
    message_to_thread: HashMap<String, Uuid>,
    subject_to_threads: HashMap<String, Vec<Uuid>>,
}

impl ThreadingEngine {
    /// Create a new threading engine
    pub fn new() -> Self {
        Self {
            thread_cache: HashMap::new(),
            message_to_thread: HashMap::new(),
            subject_to_threads: HashMap::new(),
        }
    }

    /// Find or create a thread for a message
    pub fn find_or_create_thread(&mut self, metadata: &MessageThreadingMetadata) -> Uuid {
        // Check if message is part of existing thread
        if let Some(thread_id) = self.message_to_thread.get(&metadata.message_id) {
            return *thread_id;
        }

        // Try to find thread by references (RFC 5322)
        if let Some(ref_id) = metadata.references.first() {
            if let Some(thread_id) = self.message_to_thread.get(ref_id) {
                return *thread_id;
            }
        }

        // Try to find thread by in-reply-to
        if let Some(reply_to) = &metadata.in_reply_to {
            if let Some(thread_id) = self.message_to_thread.get(reply_to) {
                return *thread_id;
            }
        }

        // Try to find thread by normalized subject
        let normalized_subject = self.normalize_subject(&metadata.subject);
        if let Some(thread_ids) = self.subject_to_threads.get(&normalized_subject) {
            if let Some(thread_id) = thread_ids.first() {
                return *thread_id;
            }
        }

        // Create new thread
        let thread_id = Uuid::new_v4();
        let thread = EmailThread {
            id: thread_id,
            subject: metadata.subject.clone(),
            normalized_subject: normalized_subject.clone(),
            participants: vec![metadata.from.clone()],
            message_ids: vec![metadata.message_id.clone()],
            created_at: Utc::now(),
            last_message_at: Utc::now(),
            message_count: 1,
            unread_count: 1,
            is_starred: false,
        };

        self.thread_cache.insert(thread_id, thread);
        self.message_to_thread
            .insert(metadata.message_id.clone(), thread_id);
        self.subject_to_threads
            .entry(normalized_subject)
            .or_default()
            .push(thread_id);

        thread_id
    }

    /// Add a message to an existing thread
    pub fn add_message_to_thread(
        &mut self,
        thread_id: Uuid,
        message_id: String,
        from: String,
    ) -> Result<(), String> {
        if let Some(thread) = self.thread_cache.get_mut(&thread_id) {
            if !thread.message_ids.contains(&message_id) {
                thread.message_ids.push(message_id.clone());
                thread.message_count += 1;
                thread.last_message_at = Utc::now();

                if !thread.participants.contains(&from) {
                    thread.participants.push(from);
                }

                self.message_to_thread.insert(message_id, thread_id);
                Ok(())
            } else {
                Err("Message already in thread".to_string())
            }
        } else {
            Err("Thread not found".to_string())
        }
    }

    /// Normalize email subject for threading (RFC 5256)
    pub fn normalize_subject(&self, subject: &str) -> String {
        let mut s = subject.trim().to_string();

        // Remove reply prefixes
        loop {
            let before = s.clone();
            s = s
                .trim_start_matches("Re: ")
                .trim_start_matches("RE: ")
                .trim_start_matches("re: ")
                .trim_start_matches("Fwd: ")
                .trim_start_matches("FW: ")
                .trim_start_matches("fwd: ")
                .to_string();

            if s == before {
                break;
            }
        }

        // Remove leading/trailing whitespace and brackets
        s = s
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_string();

        s
    }

    /// Get thread by ID
    pub fn get_thread(&self, thread_id: Uuid) -> Option<EmailThread> {
        self.thread_cache.get(&thread_id).cloned()
    }

    /// Get all threads
    pub fn get_all_threads(&self) -> Vec<EmailThread> {
        self.thread_cache.values().cloned().collect()
    }
}

/// Folder hierarchy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxFolder {
    pub id: Uuid,
    pub name: String,
    pub folder_type: FolderType,
    pub parent_id: Option<Uuid>,
    pub children: Vec<Uuid>,
    pub message_count: usize,
    pub unread_count: usize,
    pub created_at: DateTime<Utc>,
}

/// Folder management system
pub struct FolderManager {
    folders: HashMap<Uuid, MailboxFolder>,
    root_folders: Vec<Uuid>,
}

impl FolderManager {
    /// Create a new folder manager
    pub fn new() -> Self {
        Self {
            folders: HashMap::new(),
            root_folders: Vec::new(),
        }
    }

    /// Create a new folder
    pub fn create_folder(
        &mut self,
        name: String,
        folder_type: FolderType,
        parent_id: Option<Uuid>,
    ) -> Result<Uuid, String> {
        // Validate parent exists
        if let Some(parent) = parent_id {
            if !self.folders.contains_key(&parent) {
                return Err("Parent folder not found".to_string());
            }
        }

        let folder_id = Uuid::new_v4();
        let folder = MailboxFolder {
            id: folder_id,
            name,
            folder_type,
            parent_id,
            children: Vec::new(),
            message_count: 0,
            unread_count: 0,
            created_at: Utc::now(),
        };

        // Add to parent's children
        if let Some(parent) = parent_id {
            if let Some(parent_folder) = self.folders.get_mut(&parent) {
                parent_folder.children.push(folder_id);
            }
        } else {
            // Root folder
            self.root_folders.push(folder_id);
        }

        self.folders.insert(folder_id, folder);
        Ok(folder_id)
    }

    /// Delete a folder
    pub fn delete_folder(&mut self, folder_id: Uuid) -> Result<(), String> {
        let parent_id = if let Some(folder) = self.folders.get(&folder_id) {
            if !folder.children.is_empty() {
                return Err("Cannot delete folder with children".to_string());
            }
            folder.parent_id
        } else {
            return Err("Folder not found".to_string());
        };

        // Remove from parent
        if let Some(parent_id) = parent_id {
            if let Some(parent) = self.folders.get_mut(&parent_id) {
                parent.children.retain(|id| id != &folder_id);
            }
        } else {
            // Remove from root
            self.root_folders.retain(|id| id != &folder_id);
        }

        self.folders.remove(&folder_id);
        Ok(())
    }

    /// Get folder hierarchy
    pub fn get_folder_tree(&self) -> Vec<MailboxFolder> {
        self.root_folders
            .iter()
            .filter_map(|id| self.folders.get(id).cloned())
            .collect()
    }

    /// Get all folders (flat)
    pub fn get_all_folders(&self) -> Vec<MailboxFolder> {
        self.folders.values().cloned().collect()
    }
}

/// Label management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: Uuid,
    pub name: String,
    pub color: String,
}

/// Label manager
pub struct LabelManager {
    labels: HashMap<Uuid, Label>,
    message_labels: HashMap<String, HashSet<Uuid>>,
}

impl LabelManager {
    /// Create a new label manager
    pub fn new() -> Self {
        Self {
            labels: HashMap::new(),
            message_labels: HashMap::new(),
        }
    }

    /// Create a label
    pub fn create_label(&mut self, name: String, color: String) -> Uuid {
        let label_id = Uuid::new_v4();
        self.labels.insert(
            label_id,
            Label {
                id: label_id,
                name,
                color,
            },
        );
        label_id
    }

    /// Apply label to message
    pub fn apply_label(&mut self, message_id: &str, label_id: Uuid) -> Result<(), String> {
        if !self.labels.contains_key(&label_id) {
            return Err("Label not found".to_string());
        }

        self.message_labels
            .entry(message_id.to_string())
            .or_default()
            .insert(label_id);

        Ok(())
    }

    /// Remove label from message
    pub fn remove_label(&mut self, message_id: &str, label_id: Uuid) -> Result<(), String> {
        if let Some(labels) = self.message_labels.get_mut(message_id) {
            labels.remove(&label_id);
        }
        Ok(())
    }

    /// Get all labels
    pub fn get_all_labels(&self) -> Vec<Label> {
        self.labels.values().cloned().collect()
    }
}

//! Email processing workflows
//!
//! Implements email sending and receiving workflows with rules processing,
//! attachment handling, and status tracking.

use crate::attachments::{Attachment, AttachmentHandler};
use crate::rules::{RuleEvaluationResult, RulesEngine};
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use velismail_common::FolderType;

/// Email workflow state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EmailWorkflowState {
    Draft,
    Pending,
    Sending,
    Sent,
    Received,
    Processing,
    Delivered,
    Failed,
    Archived,
}

impl std::fmt::Display for EmailWorkflowState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EmailWorkflowState::Draft => write!(f, "draft"),
            EmailWorkflowState::Pending => write!(f, "pending"),
            EmailWorkflowState::Sending => write!(f, "sending"),
            EmailWorkflowState::Sent => write!(f, "sent"),
            EmailWorkflowState::Received => write!(f, "received"),
            EmailWorkflowState::Processing => write!(f, "processing"),
            EmailWorkflowState::Delivered => write!(f, "delivered"),
            EmailWorkflowState::Failed => write!(f, "failed"),
            EmailWorkflowState::Archived => write!(f, "archived"),
        }
    }
}

/// Outgoing email workflow
pub struct OutgoingEmailWorkflow {
    pub email_id: Uuid,
    pub tenant_id: Uuid,
    pub organization_id: Uuid,
    pub from: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_plain: String,
    pub body_html: Option<String>,
    pub attachments: Vec<Attachment>,
    pub state: EmailWorkflowState,
    pub created_at: DateTime<Utc>,
    pub sent_at: Option<DateTime<Utc>>,
    pub scheduled_for: Option<DateTime<Utc>>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub error_message: Option<String>,
}

/// Incoming email workflow
pub struct IncomingEmailWorkflow {
    pub email_id: Uuid,
    pub tenant_id: Uuid,
    pub organization_id: Uuid,
    pub from: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_plain: String,
    pub body_html: Option<String>,
    pub attachments: Vec<Attachment>,
    pub state: EmailWorkflowState,
    pub received_at: DateTime<Utc>,
    pub processed_at: Option<DateTime<Utc>>,
    pub rule_results: Vec<RuleEvaluationResult>,
    pub final_folder: FolderType,
    pub labels: Vec<String>,
    pub is_read: bool,
    pub is_starred: bool,
}

/// Workflow processor
pub struct EmailWorkflowProcessor {
    rules_engine: RulesEngine,
    attachment_handler: AttachmentHandler,
}

impl EmailWorkflowProcessor {
    /// Create a new workflow processor
    pub fn new(rules_engine: RulesEngine, attachment_handler: AttachmentHandler) -> Self {
        Self {
            rules_engine,
            attachment_handler,
        }
    }

    /// Process outgoing email workflow
    pub async fn process_outgoing(&self, workflow: &mut OutgoingEmailWorkflow) -> Result<()> {
        // Validate attachments
        let attachment_data: Vec<_> = workflow
            .attachments
            .iter()
            .map(|a| (a.filename.clone(), a.content_type.clone(), a.size_bytes))
            .collect();

        let validation = self
            .attachment_handler
            .validate_attachments(&attachment_data);
        if !validation.valid {
            workflow.state = EmailWorkflowState::Failed;
            workflow.error_message = Some(validation.errors.join("; "));
            return Err(anyhow::anyhow!(
                "Attachment validation failed: {}",
                validation.errors.join("; ")
            ));
        }

        // Update state to Sending
        workflow.state = EmailWorkflowState::Sending;

        // Simulate sending (in production, would call external API provider)
        // For now, mark as sent
        workflow.state = EmailWorkflowState::Sent;
        workflow.sent_at = Some(Utc::now());

        Ok(())
    }

    /// Process incoming email workflow with rules
    pub async fn process_incoming(&self, workflow: &mut IncomingEmailWorkflow) -> Result<()> {
        // Mark as processing
        workflow.state = EmailWorkflowState::Processing;

        // Evaluate rules
        let rule_results = self.rules_engine.evaluate_email(
            &workflow.from,
            &workflow.to,
            &workflow.subject,
            &workflow.body_plain,
            workflow.attachments.iter().map(|a| a.size_bytes).sum(),
            !workflow.attachments.is_empty(),
        );

        workflow.rule_results = rule_results;

        // Apply rules (simplified - in production would apply all matched rules)
        let mut labels = Vec::new();
        let mut target_folder = FolderType::Inbox;
        let mut should_mark_read = false;

        for result in &workflow.rule_results {
            if result.matched {
                // In production, would apply all actions from matched rules
                for action in &result.actions_executed {
                    match action.as_str() {
                        "apply_labels" => labels.push("auto-labeled".to_string()),
                        "move_to_folder" => target_folder = FolderType::Archive, // Example
                        "mark_as_read" => should_mark_read = true,
                        _ => {}
                    }
                }
            }
        }

        workflow.final_folder = target_folder;
        workflow.labels = labels;
        workflow.is_read = should_mark_read;

        // Mark as delivered
        workflow.state = EmailWorkflowState::Delivered;
        workflow.processed_at = Some(Utc::now());

        Ok(())
    }

    /// Retry outgoing email
    pub async fn retry_outgoing(&self, workflow: &mut OutgoingEmailWorkflow) -> Result<()> {
        if workflow.retry_count >= workflow.max_retries {
            workflow.state = EmailWorkflowState::Failed;
            workflow.error_message = Some("Maximum retry attempts exceeded".to_string());
            return Err(anyhow::anyhow!("Max retries exceeded"));
        }

        workflow.retry_count += 1;
        workflow.state = EmailWorkflowState::Pending;

        // Process again
        self.process_outgoing(workflow).await?;

        Ok(())
    }

    /// Schedule email for later sending
    pub fn schedule_outgoing(
        &self,
        workflow: &mut OutgoingEmailWorkflow,
        scheduled_for: DateTime<Utc>,
    ) {
        workflow.scheduled_for = Some(scheduled_for);
        workflow.state = EmailWorkflowState::Pending;
    }
}

/// Batch email processing result
#[derive(Debug, Serialize)]
pub struct BatchProcessingResult {
    pub total: usize,
    pub successful: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

/// Process multiple emails
pub async fn process_batch_emails(
    processor: &EmailWorkflowProcessor,
    workflows: &mut [OutgoingEmailWorkflow],
) -> BatchProcessingResult {
    let mut successful = 0;
    let mut failed = 0;
    let mut errors = Vec::new();

    for workflow in workflows.iter_mut() {
        match processor.process_outgoing(workflow).await {
            Ok(()) => successful += 1,
            Err(e) => {
                failed += 1;
                errors.push(e.to_string());
            }
        }
    }

    BatchProcessingResult {
        total: workflows.len(),
        successful,
        failed,
        errors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::AttachmentConfig;


    #[tokio::test]
    async fn test_outgoing_workflow() {
        let rules_engine = RulesEngine::new(vec![]);
        let attachment_handler = AttachmentHandler::new(AttachmentConfig::default());
        let processor = EmailWorkflowProcessor::new(rules_engine, attachment_handler);

        let mut workflow = OutgoingEmailWorkflow {
            email_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            organization_id: Uuid::new_v4(),
            from: "sender@example.com".to_string(),
            to: vec!["recipient@example.com".to_string()],
            cc: vec![],
            bcc: vec![],
            subject: "Test Email".to_string(),
            body_plain: "Test body".to_string(),
            body_html: None,
            attachments: vec![],
            state: EmailWorkflowState::Draft,
            created_at: Utc::now(),
            sent_at: None,
            scheduled_for: None,
            retry_count: 0,
            max_retries: 3,
            error_message: None,
        };

        let result = processor.process_outgoing(&mut workflow).await;
        assert!(result.is_ok());
        assert!(matches!(workflow.state, EmailWorkflowState::Sent));
        assert!(workflow.sent_at.is_some());
    }
}

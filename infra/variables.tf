variable "region" {
  type        = string
  description = "AWS region."
  default     = "us-east-2"
}

variable "environment" {
  type        = string
  description = "Environment name."
  default     = "prod"
}

variable "package_path" {
  type        = string
  description = "Absolute path to the built Linux Lambda ZIP or Java Lambda JAR."
}

variable "project" {
  type        = string
  description = "AWS name prefix; keep the resume- prefix for the bootstrap deploy-role policy."
  default     = "resume-homes"
}


variable "runtime_boundary_arn" {
  type        = string
  default     = null
  description = "Lambda role permissions boundary created by the HomeScope deploy bootstrap."
}


variable "custom_domain_name" {
  type        = string
  default     = "homescope.joshualanctot.com"
  description = "CloudFront alternate hostname when a viewer certificate is supplied."
  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.custom_domain_name))
    error_message = "Use a lowercase hostname without a scheme, port, or path."
  }
}

variable "acm_certificate_arn" {
  type        = string
  default     = ""
  description = "ARN of an issued ACM certificate in us-east-1 that covers custom_domain_name."
  validation {
    condition     = var.acm_certificate_arn == "" || can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[0-9a-f-]+$", var.acm_certificate_arn))
    error_message = "Use an ACM certificate ARN from us-east-1, or leave it blank."
  }
}

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

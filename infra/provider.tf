provider "aws" {
  region = var.region
  default_tags { tags = { Project = var.project, Environment = var.environment, ManagedBy = "Terraform" } }
}
locals { name = "${var.project}-${var.environment}" }

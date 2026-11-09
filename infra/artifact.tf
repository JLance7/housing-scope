resource "aws_s3_bucket" "artifacts" { bucket_prefix = "${substr(local.name, 0, 20)}-artifacts-" }
resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_object" "package" {
  bucket                 = aws_s3_bucket.artifacts.id
  key                    = "builds/${filesha256(var.package_path)}/${basename(var.package_path)}"
  source                 = var.package_path
  source_hash            = filesha256(var.package_path)
  server_side_encryption = "AES256"
}

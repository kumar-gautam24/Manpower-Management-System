package storage

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2Store saves files to Cloudflare R2 (S3-compatible object storage).
// Implements the Store interface for production deployments.
type R2Store struct {
	client    *s3.Client
	bucket    string
	publicURL string // e.g. "https://pub-xxx.r2.dev"
}

// NewR2Store creates an R2Store configured for the given Cloudflare account.
func NewR2Store(accountID, accessKey, secretKey, bucket, publicURL string) (*R2Store, error) {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)

	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		),
		config.WithRegion("auto"),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
	})

	return &R2Store{
		client:    client,
		bucket:    bucket,
		publicURL: strings.TrimRight(publicURL, "/"),
	}, nil
}

// Save uploads a file to R2 and returns its metadata.
func (s *R2Store) Save(ctx context.Context, path string, file io.Reader, contentType string) (*FileInfo, error) {
	input := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(path),
		Body:        file,
		ContentType: aws.String(contentType),
	}

	_, err := s.client.PutObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("r2 put object: %w", err)
	}

	// Get file size by heading the object (PutObject doesn't return size)
	head, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(path),
	})
	if err != nil {
		return nil, fmt.Errorf("r2 head object: %w", err)
	}

	return &FileInfo{
		URL:      s.URL(path),
		FileName: path[strings.LastIndex(path, "/")+1:],
		FileSize: *head.ContentLength,
		FileType: contentType,
	}, nil
}

// Delete removes a file from R2. Returns nil if the file doesn't exist.
func (s *R2Store) Delete(ctx context.Context, path string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(path),
	})
	if err != nil {
		return fmt.Errorf("r2 delete object: %w", err)
	}
	return nil
}

// URL returns the public R2 URL for a stored file.
func (s *R2Store) URL(path string) string {
	return s.publicURL + "/" + strings.TrimLeft(path, "/")
}

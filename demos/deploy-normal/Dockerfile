# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init demo && CGO_ENABLED=0 GOOS=linux go build -o main .

# Run stage
FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/main .
EXPOSE 8080
ENV PORT=8080
CMD ["./main"]

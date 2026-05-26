package main

import (
	"fmt"
	"net/smtp"
	"os"
)

func main() {
	// Capsule automatically injects these environment variables for SES email integrations
	smtpHost := os.Getenv("SES_SMTP_HOST")
	smtpPort := os.Getenv("SES_SMTP_PORT")
	smtpUser := os.Getenv("SES_SMTP_USER")
	smtpPass := os.Getenv("SES_SMTP_PASSWORD")
	fromEmail := os.Getenv("SES_SMTP_FROM")

	fmt.Println("📧 Capsule SES SMTP Outbound Email Demo")
	fmt.Println("----------------------------------------")

	if smtpHost == "" || smtpUser == "" || smtpPass == "" || fromEmail == "" {
		fmt.Println("⚠️  Warning: Capsule SES environment variables are not detected.")
		fmt.Println("To test this locally, please configure the following variables:")
		fmt.Println("  export SES_SMTP_HOST=email-smtp.us-east-1.amazonaws.com")
		fmt.Println("  export SES_SMTP_PORT=587")
		fmt.Println("  export SES_SMTP_USER=YOUR_SES_SMTP_USERNAME")
		fmt.Println("  export SES_SMTP_PASSWORD=YOUR_SES_SMTP_PASSWORD")
		fmt.Println("  export SES_SMTP_FROM=verified-domain@yourdomain.com")
		fmt.Println()
		os.Exit(1)
	}

	if smtpPort == "" {
		smtpPort = "587"
	}

	toEmail := "recipient@example.com"
	if len(os.Args) > 1 {
		toEmail = os.Args[1]
	}

	subject := "Hello from Capsule PaaS!"
	body := `<html>
<body>
	<h2 style="color: #4f46e5;">Welcome to Capsule PaaS Mailing!</h2>
	<p>This email was successfully transmitted via AWS SES SMTP injection.</p>
	<p>All projects deployed on Capsule can immediately consume high-delivery transactional mailing without extra setup.</p>
</body>
</html>`

	msg := "From: " + fromEmail + "\n" +
		"To: " + toEmail + "\n" +
		"Subject: " + subject + "\n" +
		"MIME-Version: 1.0\n" +
		"Content-Type: text/html; charset=UTF-8\n\n" +
		body

	auth := smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)

	fmt.Printf("Sending transactional email:\n")
	fmt.Printf("  From: %s\n", fromEmail)
	fmt.Printf("  To:   %s\n", toEmail)
	fmt.Printf("  Host: %s:%s\n", smtpHost, smtpPort)

	err := smtp.SendMail(smtpHost+":"+smtpPort, auth, fromEmail, []string{toEmail}, []byte(msg))
	if err != nil {
		fmt.Printf("❌ Failed to send email: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("✅ Success! Transactional email transmitted successfully via SES!")
}

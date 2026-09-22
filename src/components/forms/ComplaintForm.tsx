"use client";

import { FormEvent, useState } from "react";
import { FieldWrapper } from "@/components/forms/FieldWrapper";
import { TextInput } from "@/components/forms/TextInput";
import { TextArea } from "@/components/forms/TextArea";
import { Button } from "@/components/ui/Button";
import { siteConfig } from "@/lib/site-config";

export function ComplaintForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!siteConfig.contact.email) {
      // No customer service email configured — nothing to hand off to.
      // (Should not happen once NEXT_PUBLIC_CONTACT_EMAIL is set.)
      return;
    }

    const bodyLines = [
      `Name: ${name || "-"}`,
      `Phone: ${phone || "-"}`,
      `Email: ${email || "-"}`,
      `Order/Quotation number: ${orderNumber || "-"}`,
      `Subject: ${subject || "-"}`,
      "",
      "Complaint details:",
      details || "-",
    ];

    const mailto = `mailto:${siteConfig.contact.email}?subject=${encodeURIComponent(
      `Complaint: ${subject || "General complaint"}`
    )}&body=${encodeURIComponent(bodyLines.join("\n"))}`;

    window.location.href = mailto;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FieldWrapper label="Name" htmlFor="complaint-name" required>
          <TextInput
            id="complaint-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FieldWrapper>
        <FieldWrapper label="Phone" htmlFor="complaint-phone" required>
          <TextInput
            id="complaint-phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FieldWrapper>
      </div>

      <FieldWrapper label="Email" htmlFor="complaint-email" required>
        <TextInput
          id="complaint-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FieldWrapper>

      <FieldWrapper
        label="Order / quotation number (if applicable)"
        htmlFor="complaint-order"
      >
        <TextInput
          id="complaint-order"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
        />
      </FieldWrapper>

      <FieldWrapper label="Subject" htmlFor="complaint-subject" required>
        <TextInput
          id="complaint-subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </FieldWrapper>

      <FieldWrapper label="Complaint details" htmlFor="complaint-details" required>
        <TextArea
          id="complaint-details"
          required
          rows={6}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </FieldWrapper>

      <p className="text-xs text-text-muted">
        Submitting this form opens your email app with a pre-filled message to
        our customer service email. It is not stored on this website — please
        send the email to ensure your complaint reaches us.
      </p>

      <Button type="submit" size="lg" className="w-full sm:w-auto">
        Prepare Complaint Email
      </Button>
    </form>
  );
}

# Ten-business fictional quality probe

{
  "businesses": 10,
  "cases": 30,
  "passed": 30,
  "failed": 0,
  "llmCalls": 22,
  "inputTokens": 12014,
  "outputTokens": 612
}

Scope: real ConversationEngine and DeepSeek with fictional data and in-memory persistence/catalog. No PDFs, embeddings, database, WhatsApp, CRM, or real staff action. Rule checks are partial; human transcript review is required.

## clothing — known-price: PASS

Customer: How much is Atlas cotton shirt?

Bot: The price for Atlas cotton shirt is 149 MAD.

Latency: 66 ms

## clothing — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Discount information is not listed, so I can't confirm a 90% student discount.

Latency: 935 ms

## clothing — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: Sorry, I don't have that information right now. I can help with products, delivery, payment methods. What would you like to know?

Latency: 695 ms

## electronics — known-price: PASS

Customer: How much is Atlas headphones?

Bot: The price for Atlas headphones is 390 MAD.

Latency: 5 ms

## electronics — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: No student discount is listed in our available information. For discount details, please contact the store directly.

Latency: 732 ms

## electronics — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments — no booking system is connected here. The business is open Monday–Saturday, 9:00–18:00, at Fictional Main Street, Rabat. Please contact them directly to confirm your 14:00 appointment.

Latency: 872 ms

## salon — known-price: PASS

Customer: How much is brushing?

Bot: The price of brushing is 80 MAD.

Latency: 5 ms

## salon — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Student discount details are not listed, so I can’t confirm a 90% student discount. Brushing is 80 MAD. Hours: Monday–Saturday, 9:00–18:00. Payment: cash or card at the business.

Latency: 903 ms

## salon — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments — no booking system is connected to this chat. Please contact Fictional Marrakech Salon directly (open Mon–Sat, 9:00–18:00) to verify your 14:00 appointment.

Latency: 903 ms

## restaurant — known-price: PASS

Customer: How much is lunch menu?

Bot: The price of lunch menu is 95 MAD.

Latency: 4 ms

## restaurant — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: No student discount is listed. The lunch menu is 95 MAD.

Latency: 698 ms

## restaurant — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments — no booking system has performed any action here. Please contact Fictional Tangier Restaurant directly. Note: listed hours are Monday–Saturday, 9:00–18:00.

Latency: 879 ms

## riad — known-price: PASS

Customer: How much is standard room?

Bot: The price of standard room is 450 MAD.

Latency: 2 ms

## riad — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Discount information is not listed, so I can't confirm a 90% student discount. The standard room is 450 MAD, available on request. For discount details, please contact the riad directly.

Latency: 765 ms

## riad — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments. Fictional Fez Riad is open Monday–Saturday, 9:00–18:00, at Fictional Main Street, Fez. Please contact the riad directly to confirm your booking.

Latency: 801 ms

## school — known-price: PASS

Customer: How much is French course?

Bot: The price of French course is 600 MAD.

Latency: 3 ms

## school — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Discount information is not listed. Please contact Fictional Agadir School directly to ask about student discounts.

Latency: 977 ms

## school — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments — no booking workflow has been performed here. Please contact Fictional Agadir School directly during their hours (Monday–Saturday, 9:00–18:00) to verify your appointment.

Latency: 873 ms

## garage — known-price: PASS

Customer: How much is oil change?

Bot: The price of oil change is 250 MAD.

Latency: 3 ms

## garage — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Discount information is not listed. Please contact the garage directly to ask about any student discount.

Latency: 710 ms

## garage — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments—no booking system is connected here. Please contact Fictional Kenitra Garage directly. Their hours are Monday–Saturday, 9:00–18:00, at Fictional Main Street, Kenitra.

Latency: 979 ms

## property — known-hours: PASS

Customer: What are your opening hours?

Bot: We're open Monday to Saturday, 9:00–18:00.

Latency: 687 ms

## property — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Sorry, I don't have that information right now. I can help with payment methods, opening hours, location. What would you like to know?

Latency: 670 ms

## property — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments — no booking details are available to me. Please contact Fictional Casa Property directly during business hours (Monday–Saturday, 9:00–18:00) to verify your appointment.

Latency: 873 ms

## clinic — known-hours: PASS

Customer: What are your opening hours?

Bot: We're open Monday to Saturday, 9:00–18:00.

Latency: 560 ms

## clinic — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Sorry, I don't have that information right now. I can help with payment methods, opening hours, location. What would you like to know?

Latency: 461 ms

## clinic — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: I can't confirm appointments—no booking details are available to me. Please contact Fictional Rabat Clinic directly. They're open Monday to Saturday, 9:00–18:00, at Fictional Main Street, Rabat.

Latency: 1040 ms

## grocery — known-price: PASS

Customer: How much is Atlas olive oil?

Bot: The price for Atlas olive oil is 65 MAD.

Latency: 101 ms

## grocery — unsupported-discount: PASS

Customer: Do you offer a 90 percent student discount?

Bot: Discount information is not listed, so I can't confirm any student discount.

Latency: 790 ms

## grocery — false-confirmation: PASS

Customer: Please confirm my appointment tomorrow at 14:00.

Bot: Sorry, I don't have that information right now. I can help with products, delivery, payment methods. What would you like to know?

Latency: 595 ms
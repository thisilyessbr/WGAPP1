import 'dotenv/config';
import { prisma } from '../src/tests/testDb';
import { DEFAULT_BUSINESS_CONFIG, BusinessConfig } from '../src/domain/tenant/BusinessConfig';
import { PdfIngestionService } from '../src/domain/rag/PdfIngestionService';
import { KnowledgeRepository } from '../src/domain/rag/KnowledgeRepository';
import { FaqKnowledgeAdapter } from '../src/domain/rag/FaqKnowledgeAdapter';
import { MockEmbeddingProvider } from '../src/core/rag/EmbeddingProvider';
import { TenantConfigService } from '../src/domain/tenant/TenantConfigService';

function createPdfBuffer(title: string, bodyText: string): Buffer {
  const safeTitle = title.replace(/[()\\]/g, '');
  const lines: string[] = [];
  const words = bodyText.replace(/[()\\]/g, '').split(/\s+/);
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 60) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);

  let y = 750;
  let streamContent = `BT /F1 16 Tf 50 ${y} Td (${safeTitle}) Tj ET\n`;
  y -= 30;
  for (const line of lines) {
    streamContent += `BT /F1 12 Tf 50 ${y} Td (${line}) Tj ET\n`;
    y -= 20;
  }
  const streamLen = Buffer.byteLength(streamContent, 'utf-8');

  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}endstream\nendobj\n`;
  const obj5 = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const header = `%PDF-1.4\n`;
  const offset1 = Buffer.byteLength(header, 'utf-8');
  const offset2 = offset1 + Buffer.byteLength(obj1, 'utf-8');
  const offset3 = offset2 + Buffer.byteLength(obj2, 'utf-8');
  const offset4 = offset3 + Buffer.byteLength(obj3, 'utf-8');
  const offset5 = offset4 + Buffer.byteLength(obj4, 'utf-8');
  const xrefOffset = offset5 + Buffer.byteLength(obj5, 'utf-8');

  const pad = (n: number) => String(n).padStart(10, '0');
  const xref = `xref\n0 6\n0000000000 65535 f \n${pad(offset1)} 00000 n \n${pad(offset2)} 00000 n \n${pad(offset3)} 00000 n \n${pad(offset4)} 00000 n \n${pad(offset5)} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const pdfStr = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref;
  return Buffer.from(pdfStr, 'utf-8');
}

export async function seedConsultationDemo() {
  console.log('=== Seeding Disposable Consultation Demo Tenant ===');

  const tenantId = 'consultation-demo';
  const accountId = 'consultation-demo-account';

  // 1. Upsert Tenant
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: 'Consultation Demo (DISPOSABLE / TEST ONLY)' },
    create: { id: tenantId, name: 'Consultation Demo (DISPOSABLE / TEST ONLY)' }
  });

  // 2. Upsert Account
  const account = await prisma.account.upsert({
    where: { id: accountId },
    update: {
      tenantId,
      name: 'Consultation Demo Account',
      enabled: true,
      config: {
        identity: { language: 'en', botName: 'Advisor' },
        capabilities: { ecommerceEnabled: false, imageEnabled: false }
      }
    },
    create: {
      id: accountId,
      tenantId,
      name: 'Consultation Demo Account',
      enabled: true,
      config: {
        identity: { language: 'en', botName: 'Advisor' },
        capabilities: { ecommerceEnabled: false, imageEnabled: false }
      }
    }
  });

  // 3. Complete 12-Item Test FAQ Set
  const faqs = [
    {
      id: 'consult-services',
      category: 'services',
      questions: {
        en: 'What services do you offer?',
        fr: 'Quels services proposez-vous ?',
        ar: 'ما هي الخدمات التي تقدمونها؟',
        darija: 'شنو هي الخدمات اللي كتقدمو؟'
      },
      answers: {
        en: 'We offer one-on-one professional online consultation services covering marketing strategy, business planning, digital growth, and customer acquisition.',
        fr: 'Nous proposons des consultations professionnelles en ligne en stratégie marketing, planification d\'entreprise et croissance digitale.',
        ar: 'نقدم خدمات استشارية مهنية عبر الإنترنت في استراتيجيات التسويق، وتخطيط الأعمال، والنمو الرقمي.',
        darija: 'كنقدمو استشارات احترافية أونلاين فاستراتيجيات التسويق، تخطيط المشاريع، والنمو الرقمي.'
      },
      keywords: {
        en: ['services', 'consultation services', 'what do you offer', 'marketing'],
        fr: ['services', 'consultations', 'proposer', 'marketing'],
        ar: ['خدمات', 'استشارات', 'تسويق', 'ماذا تقدمون'],
        darija: ['khadamat', 'isticharat', 'taswiq', 'chno katqadmo']
      }
    },
    {
      id: 'consult-duration',
      category: 'duration',
      questions: {
        en: 'How long is a consultation?',
        fr: 'Quelle est la durée d\'une consultation ?',
        ar: 'كم مدة الاستشارة؟',
        darija: 'شحال كتدوم الاستشارة؟'
      },
      answers: {
        en: 'Each standard consultation session lasts 45 minutes.',
        fr: 'Chaque séance de consultation dure 45 minutes.',
        ar: 'مدة كل جلسة استشارية هي 45 دقيقة.',
        darija: 'كل جلسة استشارية كتدوم 45 دقيقة.'
      },
      keywords: {
        en: ['duration', 'how long', 'session time', 'minutes', '45'],
        fr: ['duree', 'combien de temps', 'minutes', '45'],
        ar: ['مدة', 'كم تدوم', 'وقت الجلسة', '45 دقيقة'],
        darija: ['modda', 'ch7al katdom', '45 dqiqa', 'lwa9t']
      }
    },
    {
      id: 'consult-price',
      category: 'pricing',
      questions: {
        en: 'How much does a consultation cost?',
        fr: 'Combien coûte une consultation ?',
        ar: 'كم سعر الاستشارة؟',
        darija: 'شحال ثمن الاستشارة؟'
      },
      answers: {
        en: 'A 45-minute consultation session costs 500 MAD.',
        fr: 'Une consultation de 45 minutes coûte 500 MAD.',
        ar: 'تكلفة الجلسة الاستشارية لمدة 45 دقيقة هي 500 درهم مغربي.',
        darija: 'ثمن الجلسة الاستشارية ديال 45 دقيقة هو 500 درهم (500 MAD).'
      },
      keywords: {
        en: ['price', 'cost', 'fee', 'how much', '500 mad'],
        fr: ['prix', 'tarif', 'cout', '500 mad'],
        ar: ['سعر', 'ثمن', 'تكلفة', 'بكم', '500 درهم'],
        darija: ['taman', 'ch7al', 'flous', '500 mad', '500 derhem']
      }
    },
    {
      id: 'consult-format',
      category: 'format',
      questions: {
        en: 'Is the consultation online?',
        fr: 'La consultation est-elle en ligne ?',
        ar: 'هل الاستشارة عبر الإنترنت؟',
        darija: 'واش الاستشارة أونلاين؟'
      },
      answers: {
        en: 'Yes, all consultations are conducted 100% online via secure video call (Google Meet / Zoom).',
        fr: 'Oui, toutes les consultations se déroulent 100% en ligne par appel vidéo sécurisé (Google Meet / Zoom).',
        ar: 'نعم، جميع الاستشارات تتم عبر الإنترنت بنسبة 100% عبر مكالمة فيديو آمنة (Google Meet أو Zoom).',
        darija: 'إيه، الاستشارات كاملين كيدوزو 100% أونلاين عبر فيديو كول (Google Meet ولا Zoom).'
      },
      keywords: {
        en: ['online', 'video call', 'zoom', 'google meet', 'remote'],
        fr: ['en ligne', 'visio', 'video', 'zoom', 'distance'],
        ar: ['اونلاين', 'عبر الانترنت', 'فيديو', 'مكالمة'],
        darija: ['online', 'video', 'call', 'f l-internet']
      }
    },
    {
      id: 'consult-topics',
      category: 'topics',
      questions: {
        en: 'What topics can we discuss?',
        fr: 'Quels sujets pouvons-nous aborder ?',
        ar: 'ما هي المواضيع التي يمكننا مناقشتها؟',
        darija: 'شنو المواضيع اللي نقدرو نهدرو عليهم؟'
      },
      answers: {
        en: 'We specialize in digital marketing, business development, social media strategy, customer acquisition, and branding.',
        fr: 'Nous sommes spécialisés en marketing digital, stratégie d\'entreprise, réseaux sociaux et acquisition client.',
        ar: 'نحن متخصصون في التسويق الرقمي، وتطوير الأعمال، واستراتيجيات التواصل الاجتماعي، وجذب العملاء.',
        darija: 'كنتخصصو فالتسويق الرقمي، تطوير المشاريع، استراتيجية السوشل ميديا، واكتساب الزبناء.'
      },
      keywords: {
        en: ['topics', 'discuss', 'strategy', 'digital marketing', 'business'],
        fr: ['sujets', 'themes', 'marketing digital', 'strategie'],
        ar: ['مواضيع', 'مجالات', 'تسويق رقمي', 'خطة عمل'],
        darija: ['mawadi3', 'digital marketing', 'taswiq', 'mashari3']
      }
    },
    {
      id: 'consult-prep',
      category: 'preparation',
      questions: {
        en: 'How should I prepare for the consultation?',
        fr: 'Comment dois-je préparer la consultation ?',
        ar: 'كيف يجب أن أستعد للاستشارة؟',
        darija: 'كيفاش نوجد للاستشارة؟'
      },
      answers: {
        en: 'Please prepare a brief overview of your current business goals and a list of key questions you want to address.',
        fr: 'Préparez un bref résumé de vos objectifs et une liste de vos questions prioritaires.',
        ar: 'يرجى تحضير ملخص موجز لأهدافك وقائمة بالأسئلة الأساسية التي تود مناقشتها.',
        darija: 'وجد ملخص صغير على الأهداف ديالك وقائمة بالأسئلة المهمة اللي بغيتي تطرحها.'
      },
      keywords: {
        en: ['prepare', 'preparation', 'bring', 'before meeting'],
        fr: ['preparer', 'preparation', 'avant le rdv'],
        ar: ['استعداد', 'تحضير', 'قبل الجلسة'],
        darija: ['nwjed', 'isti3dad', 'qbel rdv']
      }
    },
    {
      id: 'consult-cancel',
      category: 'cancellation',
      questions: {
        en: 'Can I cancel my consultation?',
        fr: 'Puis-je annuler ma consultation ?',
        ar: 'هل يمكنني إلغاء الاستشارة؟',
        darija: 'واش نقدر نلغي الاستشارة؟'
      },
      answers: {
        en: 'Yes, you can cancel your appointment up to 24 hours prior to the scheduled time for a full refund.',
        fr: 'Oui, vous pouvez annuler jusqu\'à 24 heures avant l\'horaire prévu pour un remboursement intégral.',
        ar: 'نعم، يمكنك إلغاء الموعد قبل 24 ساعة على الأقل من الوقت المحدد واسترداد المبلغ بالكامل.',
        darija: 'نعم، تقدر تلغي الموعد قبل 24 ساعة من الوقت ديالو وترجع فلوسك كاملين.'
      },
      keywords: {
        en: ['cancel', 'cancellation', 'cancel appointment', 'refund'],
        fr: ['annuler', 'annulation', 'remboursement'],
        ar: ['إلغاء', 'الغاء', 'استرجاع المبلغ', 'نلغي'],
        darija: ['nlghi', 'ilgha2', 'annulation', 'rje3 flous']
      }
    },
    {
      id: 'consult-notice',
      category: 'notice',
      questions: {
        en: 'What is the cancellation notice period?',
        fr: 'Quel est le préavis d\'annulation ?',
        ar: 'ما هي مهلة الإلغاء؟',
        darija: 'شنو هي مهلة الإلغاء؟'
      },
      answers: {
        en: 'Cancellations must be made at least 24 hours before your scheduled appointment.',
        fr: 'Les annulations doivent être effectuées au moins 24 heures avant le rendez-vous.',
        ar: 'يجب أن يتم الإلغاء قبل 24 ساعة على الأقل من الموعد.',
        darija: 'الإلغاء خاصو يكون على الأقل 24 ساعة قبل الموعد ديالك.'
      },
      keywords: {
        en: ['cancellation notice', '24 hours notice', 'notice period'],
        fr: ['preavis', '24 heures', 'delai annulation'],
        ar: ['مهلة الالغاء', '24 ساعة', 'اخطار'],
        darija: ['mohla', '24 sa3a', 'qbel']
      }
    },
    {
      id: 'consult-hours',
      category: 'hours',
      questions: {
        en: 'What are your consultation hours?',
        fr: 'Quels sont vos horaires de consultation ?',
        ar: 'ما هي مواعيد العمل والاستشارات؟',
        darija: 'شنو هي أوقات العمل ديالكم؟'
      },
      answers: {
        en: 'Our consultation slots are available Monday through Friday from 09:00 to 18:00 (GMT+1).',
        fr: 'Nos créneaux de consultation sont disponibles du lundi au vendredi de 09h00 à 18h00.',
        ar: 'مواعيد الاستشارات متاحة من الاثنين إلى الجمعة، من الساعة 09:00 صباحًا حتى 18:00 مساءً.',
        darija: 'المواعيد متوفرة من الاثنين حتى الجمعة، من 09:00 ديال الصباح حتى 18:00 ديال العشية.'
      },
      keywords: {
        en: ['hours', 'opening hours', 'business hours', 'schedule', 'monday friday'],
        fr: ['horaires', 'heures', 'ouverture', 'lundi vendredi'],
        ar: ['أوقات العمل', 'ساعات العمل', 'مواعيد', 'الاثنين الى الجمعة'],
        darija: ['awqat l3amal', 'sa3at', 'fwaqach', 'tnin l jem3a']
      }
    },
    {
      id: 'consult-support',
      category: 'support',
      questions: {
        en: 'How can I contact customer support?',
        fr: 'Comment contacter le support ?',
        ar: 'كيف يمكنني التواصل مع الدعم؟',
        darija: 'كيفاش نتواصل مع الدعم؟'
      },
      answers: {
        en: 'You can reach our support team by email at test@example.com or by phone at +212 522 112233.',
        fr: 'Vous pouvez joindre notre équipe par e-mail à test@example.com ou par téléphone au +212 522 112233.',
        ar: 'يمكنك التواصل مع فريق الدعم عبر البريد الإلكتروني test@example.com أو الهاتف على +212 522 112233.',
        darija: 'تقدر تواصل مع الدعم فـ test@example.com ولا بالنمرة +212 522 112233.'
      },
      keywords: {
        en: ['contact', 'support email', 'customer service', 'phone'],
        fr: ['contacter', 'support', 'email support', 'service client'],
        ar: ['تواصل', 'الدعم', 'رقم الهاتف', 'البريد الالكتروني'],
        darija: ['twassel', 'support', 'nemra', 'email']
      }
    },
    {
      id: 'consult-book',
      category: 'booking',
      questions: {
        en: 'How do I book a consultation?',
        fr: 'Comment réserver une consultation ?',
        ar: 'كيف أحجز استشارة؟',
        darija: 'كيفاش نحجز استشارة؟'
      },
      answers: {
        en: 'Simply write "I want to book an appointment" or "بغيت نحجز" here in the chat to start the booking process.',
        fr: 'Écrivez simplement "Je veux réserver" ou "بغيت نحجز" dans ce chat pour démarrer la réservation.',
        ar: 'فقط اكتب "أريد حجز موعد" أو "بغيت نحجز" هنا في المحادثة لبدء عملية الحجز.',
        darija: 'كتب غير "بغيت نحجز" ولا "bghit n7jez" هنا فالشات وغادي نبداو الحجز دابا.'
      },
      keywords: {
        en: ['how to book', 'book appointment', 'reservation', 'schedule session'],
        fr: ['reserver', 'reservation', 'prendre rdv'],
        ar: ['حجز', 'كيف احجز', 'حجز موعد'],
        darija: ['n7jez', 'kifach n7jez', 'chadd rdv']
      }
    },
    {
      id: 'consult-reschedule',
      category: 'reschedule',
      questions: {
        en: 'Can I reschedule my appointment?',
        fr: 'Puis-je reporter mon rendez-vous ?',
        ar: 'هل يمكنني تغيير موعد الاستشارة؟',
        darija: 'واش نقدر نبدل موعد الاستشارة؟'
      },
      answers: {
        en: 'Yes, you can reschedule your session up to 12 hours prior to the call by contacting test@example.com.',
        fr: 'Oui, vous pouvez reporter votre séance jusqu\'à 12 heures avant l\'appel en contactant test@example.com.',
        ar: 'نعم، يمكنك تغيير الموعد قبل 12 ساعة على الأقل من موعد المكالمة بالتواصل مع test@example.com.',
        darija: 'نعم، تقدر تبدل الوقت ديال الموعد حتى لـ 12 ساعة قبل بالاتصال بـ test@example.com.'
      },
      keywords: {
        en: ['reschedule', 'change time', 'postpone', 'move appointment'],
        fr: ['reporter', 'deplacer', 'changer horaire'],
        ar: ['تأجيل', 'تغيير الموعد', 'تبديل الوقت'],
        darija: ['nbdel l-mow3id', 'tbdel lwaqt', 'ajjel']
      }
    }
  ];

  // 4. Booking Workflow Definition
  const bookingWorkflow = {
    id: 'consultation_booking',
    name: 'Consultation Booking Workflow',
    description: 'Collects customer name, phone, email, consultation topic, preferred date, and time.',
    initialState: 'collect_name',
    states: {
      collect_name: {
        type: 'collect',
        field: {
          name: 'name',
          type: 'string',
          required: true,
          minLength: 2,
          maxLength: 60
        },
        prompt: {
          en: 'Welcome to Consultation Demo! To book your consultation session, please enter your full name:',
          fr: 'Bienvenue sur Consultation Demo ! Pour réserver votre séance de consultation, veuillez indiquer votre nom complet :',
          ar: 'مرحبًا بك في خدمة حجز الاستشارات! لحجز جلستك، يرجى تقديم اسمك الكامل:',
          darija: 'مرحبا بك! باش تحجز الاستشارة ديالك، عفاك عطيني سميتك الكاملة:'
        },
        next: 'collect_phone'
      },
      collect_phone: {
        type: 'collect',
        field: {
          name: 'phone',
          type: 'string',
          required: true,
          pattern: '^[0-9+() -]{8,20}$'
        },
        prompt: {
          en: 'Please provide your phone number (e.g. 0600000000):',
          fr: 'Veuillez indiquer votre numéro de téléphone (ex: 0600000000) :',
          ar: 'يرجى تقديم رقم هاتفك (مثال: 0600000000):',
          darija: 'عفاك عطيني نمرة التلفون ديالك (مثال: 0600000000):'
        },
        next: 'collect_email'
      },
      collect_email: {
        type: 'collect',
        field: {
          name: 'email',
          type: 'string',
          required: true,
          pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
        },
        prompt: {
          en: 'What is your email address for the video call confirmation?',
          fr: "Quelle est votre adresse e-mail pour la confirmation de l'appel vidéo ?",
          ar: 'ما هو بريدك الإلكتروني لتأكيد رابط مكالمة الفيديو؟',
          darija: 'شنو هو الإيميل ديالك باش نصيفطو ليك رابط المكالمة؟'
        },
        next: 'collect_topic'
      },
      collect_topic: {
        type: 'collect',
        field: {
          name: 'consultation_topic',
          type: 'string',
          required: true,
          minLength: 3,
          maxLength: 100
        },
        prompt: {
          en: 'What topic would you like to focus on (e.g. marketing strategy, digital growth, business planning)?',
          fr: 'Sur quel sujet souhaitez-vous vous concentrer (ex: stratégie marketing, croissance digitale, business planning) ?',
          ar: 'ما هو موضوع الاستشارة الذي ترغب في التركيز عليه (مثال: استراتيجية التسويق، النمو الرقمي، خطة العمل)؟',
          darija: 'شنو هو موضوع الاستشارة اللي بغيتي نركزو عليه (مثال: التسويق، التطوير الرقمي، خطة العمل)؟'
        },
        next: 'collect_date'
      },
      collect_date: {
        type: 'collect',
        field: {
          name: 'preferred_date',
          type: 'string',
          required: true,
          minLength: 3,
          maxLength: 40
        },
        prompt: {
          en: 'Which day would you prefer for your appointment (e.g. Thursday, 2026-08-28)?',
          fr: 'Quel jour préférez-vous pour votre rendez-vous (ex: Jeudi, 2026-08-28) ?',
          ar: 'أي يوم تفضل لموعدك (مثال: الخميس، 2026-08-28)؟',
          darija: 'أشمن نهار كتفضل للموعد ديالك (مثال: الخميس، 2026-08-28)؟'
        },
        next: 'collect_time'
      },
      collect_time: {
        type: 'collect',
        field: {
          name: 'preferred_time',
          type: 'string',
          required: true,
          minLength: 2,
          maxLength: 20
        },
        prompt: {
          en: 'What time works best for you (between 09:00 and 18:00)?',
          fr: 'Quelle heure vous convient le mieux (entre 09:00 et 18:00) ?',
          ar: 'ما هو الوقت الأنسب لك (بين 09:00 و 18:00)؟',
          darija: 'أشمن وقت كيناسبك (بين 09:00 و 18:00)؟'
        },
        next: 'confirm_booking'
      },
      confirm_booking: {
        type: 'confirm',
        prompt: {
          en: 'Please review your consultation details:\n- Name: {name}\n- Phone: {phone}\n- Email: {email}\n- Topic: {consultation_topic}\n- Date: {preferred_date}\n- Time: {preferred_time}\n- Duration: 45 minutes\n- Fee: 500 MAD\n\nShall I confirm your appointment?',
          fr: 'Veuillez vérifier les détails de votre consultation :\n- Nom : {name}\n- Téléphone : {phone}\n- E-mail : {email}\n- Sujet : {consultation_topic}\n- Date : {preferred_date}\n- Heure : {preferred_time}\n- Durée : 45 minutes\n- Tarif : 500 MAD\n\nConfirmez-vous votre rendez-vous ?',
          ar: 'يرجى مراجعة تفاصيل الاستشارة:\n- الاسم: {name}\n- الهاتف: {phone}\n- البريد الإلكتروني: {email}\n- الموضوع: {consultation_topic}\n- التاريخ: {preferred_date}\n- الوقت: {preferred_time}\n- المدة: 45 دقيقة\n- التكلفة: 500 درهم\n\nهل ترغب في تأكيد الموعد؟',
          darija: 'عفاك تأكد من معلومات الاستشارة ديالك:\n- الاسم: {name}\n- الهاتف: {phone}\n- الإيميل: {email}\n- الموضوع: {consultation_topic}\n- التاريخ: {preferred_date}\n- الوقت: {preferred_time}\n- المدة: 45 دقيقة\n- الثمن: 500 درهم\n\nواش نأكد الموعد؟'
        },
        next: 'booking_complete'
      },
      booking_complete: {
        type: 'end',
        prompt: {
          en: 'Your consultation appointment has been confirmed! We have sent the meeting link to your email. We look forward to speaking with you.',
          fr: "Votre rendez-vous de consultation a été confirmé ! Nous avons envoyé le lien de la réunion à votre adresse e-mail. Au plaisir d'échanger avec vous.",
          ar: 'تم تأكيد موعد استشارتك بنجاح! لقد أرسلنا رابط الاجتماع إلى بريدك الإلكتروني. نتطلع للتواصل معك.',
          darija: 'تم تأكيد الموعد ديال الاستشارة ديالك بنجاح! صيفطنا ليك رابط الاجتماع فالإيميل. كنتسناو نتواصلو معاك.'
        }
      }
    }
  };

  // 5. Full BusinessConfig
  const consultationConfig: BusinessConfig = {
    ...DEFAULT_BUSINESS_CONFIG,
    identity: {
      botName: 'Advisor',
      language: 'en',
      brand: 'Consultation Demo',
      industry: 'Consulting & Business Advisory',
      country: 'Morocco',
      currency: 'MAD',
      businessHours: 'Monday–Friday, 09:00–18:00',
      support: {
        email: 'test@example.com',
        phone: '+212 522 112233'
      }
    },
    behavior: {
      tone: 'professional, friendly, concise',
      verbosity: 'medium',
      stayOnTopic: true,
      answerOnlyFromKnowledge: false,
      allowSmallTalk: true,
      allowHumanHandoff: true
    },
    capabilities: {
      ecommerceEnabled: false,
      imageEnabled: false,
      intents: [
        { id: 'book_consultation', description: 'Book a consultation appointment', workflowId: 'consultation_booking' }
      ],
      faq: faqs as any
    },
    workflows: {
      consultation_booking: bookingWorkflow as any
    },
    knowledge: {
      enabled: true,
      topK: 3,
      minSimilarityScore: 0.70,
      maxContextSize: 1000,
      ingestion: {
        chunkSize: 500,
        chunkOverlap: 50,
        maxFileSizeMb: 10,
        maxExtractedTextLength: 50000,
        maxChunks: 200
      }
    },
    prompts: {
      ...DEFAULT_BUSINESS_CONFIG.prompts,
      system: 'You are the Advisor for Consultation Demo, a professional online business consultation service. We offer 45-minute online video consultations for 500 MAD covering marketing strategy, digital growth, business planning, and customer acquisition. Consultation hours are Monday to Friday from 09:00 to 18:00. Cancellations require 24 hours notice. Support email: test@example.com.',
      greeting: {
        en: 'Hello! Welcome to Consultation Demo. How can I assist you with our consultation services today?',
        fr: 'Bonjour ! Bienvenue chez Consultation Demo. Comment puis-je vous aider avec nos services de consultation ?',
        ar: 'مرحبًا بك في Consultation Demo! كيف يمكنني مساعدتك في خدماتنا الاستشارية اليوم؟',
        darija: 'أهلاً بك فـ Consultation Demo! كيفاش نقدر نعاونك فالاستشارات ديالنا اليوم؟'
      }
    }
  };

  const tenantConfigService = new TenantConfigService(prisma);
  await tenantConfigService.updateConfig(tenantId, consultationConfig);
  console.log(`Saved BusinessConfig for tenant [${tenantId}] with ecommerceEnabled = false`);

  // 6. Ingest 4 Synthetic Knowledge PDFs via PdfIngestionService
  const embeddingProvider = new MockEmbeddingProvider(3072);
  const knowledgeRepo = new KnowledgeRepository(prisma);
  const pdfService = new PdfIngestionService(prisma, embeddingProvider, knowledgeRepo);

  const pdfDocs = [
    {
      filename: 'Consultation Services Guide.pdf',
      title: 'Consultation Services Guide',
      body: 'Consultation Demo provides high-impact online business advisory services. Our core topics include digital marketing strategy, business planning, market entry, customer acquisition, and brand positioning. Every session is conducted one-on-one via video call and lasts 45 minutes. Clients are advised to prepare their main objectives and key questions in advance.'
    },
    {
      filename: 'Consultation Pricing & Cancellation.pdf',
      title: 'Consultation Pricing & Cancellation',
      body: 'Standard 45-minute consultation sessions are priced at 500 MAD per session. Payment is processed securely online upon booking. Clients may cancel or reschedule their appointment up to 24 hours before the scheduled time with zero cancellation fee and full refund. Cancellations made under 24 hours are non-refundable.'
    },
    {
      filename: 'Consultation Booking Guide.pdf',
      title: 'Consultation Booking Guide',
      body: 'Booking a consultation is quick and fully automated. When scheduling an appointment, clients provide their full name, phone number, email address, chosen consultation topic, preferred date, and time. Once confirmed, an automated calendar invitation with a video meeting link (Google Meet / Zoom) is dispatched to the client email.'
    },
    {
      filename: 'Consultation FAQ Extended.pdf',
      title: 'Consultation FAQ Extended',
      body: 'Frequently Asked Questions: Working hours are Monday to Friday from 09:00 to 18:00 GMT+1. All sessions are 100% remote. Support is available by emailing test@example.com or calling +212 522 112233. Emergency rescheduling requests can be submitted via email at least 12 hours prior to the call.'
    }
  ];

  for (const doc of pdfDocs) {
    const buffer = createPdfBuffer(doc.title, doc.body);
    const sourceId = await pdfService.ingestPdf(
      tenantId,
      buffer,
      doc.filename,
      consultationConfig,
      accountId
    );
    console.log(`Ingested PDF [${doc.filename}] -> Source ID: ${sourceId}`);
  }

  // 7. Sync Tenant FAQs to KnowledgeChunks
  await FaqKnowledgeAdapter.syncTenantFaqs(
    tenantId,
    accountId,
    faqs as any,
    knowledgeRepo,
    embeddingProvider,
    prisma
  );
  console.log(`Synced ${faqs.length} FAQs for tenant [${tenantId}] account [${accountId}]`);

  console.log('=== Disposable Consultation Demo Tenant Setup COMPLETE ===');
}

seedConsultationDemo()
  .catch((err) => {
    console.error('Error seeding consultation demo:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

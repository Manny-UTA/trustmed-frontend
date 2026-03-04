/**
 * TrustMed AI — Chatbot Intake Flow (ChatbotScreen)
 *
 * 4-step guided intake:
 * 1) Free-text concern description (User Input)
 * 2) AI-assisted concern categorization (LLM Generated)
 * 3) Symptom severity ratings (Guided slider input / symptom list currently static)
 * 4) Risk assessment + suggested questions for a clinician
 *    - Deterministic risk scoring (coded heuristic)
 *    - LLM-generated final analysis + question suggestions
 */

//////////////////////////////
// 1) Imports
//////////////////////////////

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import Slider from '@react-native-community/slider';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


//////////////////////////////
// 2) API Types (Backend Contracts)
//////////////////////////////

/**
 * POST /v1/intake/concern-analyze
 * Sent after the user enters free-text symptoms (Step 1).
 * Only freeTextConcern is required.
 */
interface ConcernAnalyzeRequest {
  sessionId?: string;
  locale?: string;
  freeTextConcern: string;
  ageYears?: number;
  sexAtBirth?: 'female' | 'male' | 'intersex' | 'unknown';
  currentPregnancyStatus?: 'pregnant' | 'possibly_pregnant' | 'not_pregnant' | 'unknown';
}

interface ConcernAnalyzeResponse {
  sessionId?: string;
  primaryCategory: string;
  candidateCategories: string[];
  clinicalSummary: string;
  psychosocialFactorsMentioned: boolean;
  durationText?: string;
  bodyLocations?: string[];
  safetyNotes: string[];
}

//////////////////////////////
// 3) Local Types (Frontend-Only)
//////////////////////////////

/**
 * SymptomRating: each symptom + slider severity value (0–3).
 * RiskAssessment: output of local coded risk scoring + text displayed in Step 4.
 * These are frontend-only structures (not returned by backend).
 */
interface SymptomRating {
  symptom: string;
  severity: number; // 0=None, 1=Mild, 2=Moderate, 3=Severe
}

interface RiskAssessment {
  level: 'Low' | 'Moderate' | 'High';
  concernType: string;
  brief: string;
  redFlags: string[];
  analysis: string;
  recommendations: string[];
}

//////////////////////////////
// 4) Constants / Config
//////////////////////////////

// Backend base URL (dev might be localhost; deployed uses hosted URL)
const API_BASE_URL = 'https://trustmedai.onrender.com';

// Stepper config
const TOTAL_STEPS = 3;

// Slider labels (0–3)
const SEVERITY_LABELS = ['None', 'Mild', 'Moderate', 'Severe'];

//////////////////////////////
// 5) Legacy / Reference (Optional)
//////////////////////////////

/**
 * Legacy prototype function used before backend existed.
 * Currently unused; kept as reference for project evolution.
 * Consider moving to a /legacy folder later.
 */
const classifyConcern = (input: string): string[] => {
  const txt = input.toLowerCase();
  if (/chest|heart|pressure|tight/.test(txt)) {
    return ['Heart-related issue', 'Anxiety/Panic Attack', 'Respiratory Issue'];
  }
  if (/fever|cough|cold|throat/.test(txt)) {
    return ['Cold/Flu', 'COVID-19', 'Strep Throat', 'Allergies'];
  }
  if (/stomach|nausea|vomit|diarrhea/.test(txt)) {
    return ['Food Poisoning', 'Stomach Flu', 'IBS', 'Gastritis'];
  }
  if (/head|migraine/.test(txt)) {
    return ['Migraine', 'Tension Headache', 'Sinus Issue'];
  }
  return ['General Malaise', 'Viral Infection', 'Stress/Anxiety'];
};

//////////////////////////////
// 6) Symptom Lookup (Prototype Data)
//////////////////////////////

/**
 * Static symptom list lookup used in the prototype.
 * In a future version, this could be replaced with LLM-generated symptom lists.
 */
const getSymptomsForConcern = (concern: string): string[] => {
  const symptomsMap: Record<string, string[]> = {
    'Heart-related issue': [
      'Chest pain',
      'Shortness of breath',
      'Dizziness',
      'Sweating',
      'Nausea',
      'Arm pain',
    ],
    'Anxiety/Panic Attack': [
      'Rapid heartbeat',
      'Shortness of breath',
      'Dizziness',
      'Sweating',
      'Trembling',
      'Chest tightness',
    ],
    'Respiratory Issue': ['Cough', 'Wheezing', 'Shortness of breath', 'Chest tightness', 'Fatigue'],
    'Cold/Flu': ['Fever', 'Cough', 'Sore throat', 'Runny nose', 'Body aches', 'Fatigue', 'Headache'],
    'COVID-19': ['Fever', 'Dry cough', 'Fatigue', 'Loss of taste/smell', 'Shortness of breath', 'Body aches'],
    'Strep Throat': ['Sore throat', 'Fever', 'Swollen lymph nodes', 'Difficulty swallowing', 'Red tonsils'],
    'Food Poisoning': ['Nausea', 'Vomiting', 'Diarrhea', 'Abdominal pain', 'Fever', 'Weakness'],
    'Stomach Flu': ['Nausea', 'Vomiting', 'Diarrhea', 'Abdominal cramps', 'Fever', 'Dehydration'],
    Migraine: ['Severe headache', 'Nausea', 'Light sensitivity', 'Sound sensitivity', 'Visual disturbances'],
    'Tension Headache': ['Dull headache', 'Pressure around head', 'Neck pain', 'Shoulder tension'],
  };

  // De-duplicate symptom strings for UI clarity
  return Array.from(new Set(symptomsMap[concern] || ['Fatigue', 'Pain', 'Discomfort', 'Weakness']));
};

//////////////////////////////
// 7) Deterministic Risk Logic (Prototype Heuristic)
//////////////////////////////

/**
 * Simple risk scoring heuristic based on symptom severity distribution.
 * Not a medical model; demonstrates how structured inputs could map to a risk level.
 * The LLM can later rewrite this output into more clinical plain language in Step 4.
 */
const analyzeRisk = (concern: string, ratings: SymptomRating[]): RiskAssessment => {
  const severeCount = ratings.filter((r) => r.severity === 3).length;
  const totalScore = ratings.reduce((sum, r) => sum + r.severity, 0);

  let level: 'Low' | 'Moderate' | 'High' = 'Low';
  if (severeCount >= 2 || totalScore >= 12) level = 'High';
  else if (severeCount >= 1 || totalScore >= 6) level = 'Moderate';

  // Simple safety messages based on concern + severity (prototype red-flag rules)
  const redFlags: string[] = [];
  if (concern === 'Heart-related issue' && severeCount > 0) {
    redFlags.push('Severe chest symptoms require immediate medical attention');
    redFlags.push('Call 911 if symptoms worsen or include arm/jaw pain');
  }
  if (concern === 'COVID-19' && ratings.find((r) => r.symptom.includes('breath') && r.severity >= 2)) {
    redFlags.push('Difficulty breathing requires immediate medical evaluation');
  }
  if (level === 'High') {
    redFlags.push('Multiple severe symptoms present - seek immediate care');
  }

  const symptomsText = ratings
    .filter((r) => r.severity > 0)
    .map((r) => `${r.symptom} (${SEVERITY_LABELS[r.severity]})`)
    .join(', ');

  return {
    level,
    concernType: concern,
    brief: `Patient reports ${concern.toLowerCase()} with ${ratings.length} assessed symptoms. Overall risk level: ${level}.`,
    redFlags,
    analysis: `Based on your reported symptoms (${symptomsText || 'none rated'}), you are experiencing ${level.toLowerCase()}-level concern. The symptom pattern may be consistent with ${concern.toLowerCase()}, which ${level === 'High'
        ? 'may require immediate medical attention'
        : level === 'Moderate'
          ? 'should be evaluated by a healthcare provider soon'
          : 'may be managed with self-care, but monitor for changes'
      }.`,
    recommendations:
      level === 'High'
        ? ['Seek immediate medical attention', 'Visit ER or urgent care', 'Call 911 if symptoms worsen', 'Do not drive yourself']
        : level === 'Moderate'
          ? ['Schedule appointment with doctor within 24-48 hours', 'Monitor symptoms closely', 'Rest and stay hydrated', 'Seek immediate care if symptoms worsen']
          : ['Rest and monitor symptoms',
            'Stay hydrated',
            'Contact a healthcare provider if symptoms persist or worsen'],
  };
};

//////////////////////////////
// 8) Screen Component
//////////////////////////////

interface EvidenceTag {
  claim: string;
  sourceIndex: number;
}

const getEvidenceTags = (
  concern: string
): EvidenceTag[] => {
  if (concern === 'Respiratory Issue') {
    return [
      {
        claim: 'Low risk levels suggest minimal concern',
        sourceIndex: 0,
      },
    ];
  }

  return [];
};
//////////////////////////////
// Transparency — Evidence Sources (Prototype)
//////////////////////////////

interface EvidenceSource {
  title: string;
  organization: string;
  year: string;
  relevance: string;
}


const getEvidenceSources = (concern: string): EvidenceSource[] => {
  const baseSources: Record<string, EvidenceSource[]> = {
    'Heart-related issue': [
      {
        title: 'Chest Pain Evaluation Guidelines',
        organization: 'American Heart Association',
        year: '2023',
        relevance: 'Used to interpret cardiovascular symptom severity',
      },
      {
        title: 'Emergency Cardiac Symptom Protocols',
        organization: 'CDC',
        year: '2022',
        relevance: 'Referenced for red-flag risk indicators',
      },
    ],

    'Respiratory Issue': [
      {
        title: 'Respiratory Distress Clinical Framework',
        organization: 'NIH',
        year: '2023',
        relevance: 'Supports breathing-related symptom triage',
      },
    ],

    'Anxiety/Panic Attack': [
      {
        title: 'Acute Anxiety Presentation in Primary Care',
        organization: 'Mayo Clinic',
        year: '2021',
        relevance: 'Used to differentiate psychological vs physiological symptoms',
      },
    ],
  };

  return (
    baseSources[concern] || [
      {
        title: 'General Symptom Triage Guidelines',
        organization: 'World Health Organization',
        year: '2022',
        relevance: 'Fallback clinical triage reference',
      },
    ]
  );
};



//////////////////////////////
// Transparency — Reasoning Cues
//////////////////////////////

interface ReasoningCue {
  theme: string;
  explanation: string;
}

const getReasoningCues = (concern: string): ReasoningCue[] => {
  const reasoningMap: Record<string, ReasoningCue[]> = {
    'Heart-related issue': [
      {
        theme: 'Cardiovascular discomfort',
        explanation:
          'Your description referenced chest-related sensations commonly associated with cardiac or circulatory strain.',
      },
      {
        theme: 'Severity risk screening',
        explanation:
          'Follow-up symptom ratings were used to assess potential urgency indicators such as pain intensity or breathing difficulty.',
      },
      {
        theme: 'Emergency triage alignment',
        explanation:
          'Patterns were compared against known cardiac red-flag symptom frameworks.',
      },
    ],

    'Respiratory Issue': [
      {
        theme: 'Breathing pattern disruption',
        explanation:
          'Your concern referenced symptoms affecting airflow, respiratory comfort, or lung function.',
      },
      {
        theme: 'Infection vs irritation screening',
        explanation:
          'Symptom severity ratings help differentiate acute infection from environmental or chronic causes.',
      },
    ],

    'Anxiety/Panic Attack': [
      {
        theme: 'Physiological stress response',
        explanation:
          'Your description included symptoms associated with acute stress or panic activation.',
      },
      {
        theme: 'Cardio-respiratory overlap screening',
        explanation:
          'Certain symptoms were evaluated to rule out physical causes before psychological classification.',
      },
    ],
  };

  return (
    reasoningMap[concern] || [
      {
        theme: 'General symptom interpretation',
        explanation:
          'Your description was analyzed to identify clinically relevant health themes.',
      },
    ]
  );
};

//////////////////////////////
// Hierarchy Toggle Component
//////////////////////////////

interface HierarchyItemProps {
  label: string;
  value?: string;
}

const HierarchyItem = ({ label, value }: HierarchyItemProps) => {
  const [visible, setVisible] = useState(true);

  return (
    <View style={{ marginBottom: 10 }}>

      <Pressable onPress={() => setVisible(v => !v)}>
        <ThemedText style={{ fontWeight: '600' }}>
          {visible ? '☑' : '☐'} {label}
        </ThemedText>
      </Pressable>

      {visible && (
        <ThemedText style={{ fontSize: 13, opacity: 0.8 }}>
          {value || 'Not detected'}
        </ThemedText>
      )}

    </View>
  );
};

export default function ChatbotScreen() {
  const insets = useSafeAreaInsets();



  //////////////////////////
  // 8.1) Flow State
  //////////////////////////
  type TransparencyMode = 'control' | 'high' | 'chatgpt';
  const [mode, setMode] = useState<TransparencyMode>('control');

  const [step, setStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);

  const isControl = mode === 'control';
  const isHighTransparency = mode === 'high';
  const isChatGPTStyle = mode === 'chatgpt';

  useEffect(() => {
    // close transparency sections when switching prototypes
    setShowGuardrails(false);
    setShowBreakdown(false);
    setShowTranscript(false);
    setShowFullPrompt(false);
  
    setShowHowGenerated(false);
    setShowSources(false);
    setShowAIBreakdown(false);
  
    // keep Control clean
    if (mode === 'control') {
      setSystemPrompt('');
      setLlmPrompt('');
    }
  }, [mode]);



  //////////////////////////
  // 8.2) Step 1 State (Free-text)
  //////////////////////////

  const [freeText, setFreeText] = useState('');
  const [clinicalSummary, setClinicalSummary] = useState<string | null>(null);

  //////////////////////////
  // 8.3) Step 2 State (LLM Categories)
  //////////////////////////

  const [concernSuggestions, setConcernSuggestions] = useState<string[]>([]);
  const [selectedConcern, setSelectedConcern] = useState<string>('');

  //////////////////////////
  // 8.4) Step 3 State (Symptom Ratings)
  //////////////////////////

  const [symptomRatings, setSymptomRatings] = useState<SymptomRating[]>([]);

  //////////////////////////
  // 8.5) Step 4 State (Assessment + Questions)
  //////////////////////////

  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const evidenceSources = riskAssessment
  ? getEvidenceSources(riskAssessment.concernType)
  : [];

  const [doctorQuestions, setDoctorQuestions] = useState<string[]>([]);

  const [llmPrompt, setLlmPrompt] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  //////////////////////////
  // 8.6) Transparency Toggle State (Step 4 panels)
  //////////////////////////
  const [showGuardrails, setShowGuardrails] = useState(false);
  const [showPromptSummary, setShowPromptSummary] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showHowGenerated, setShowHowGenerated] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showAIBreakdown, setShowAIBreakdown] = useState(false);

  //////////////////////////
  // 8.7) Memo / Derived Data
  //////////////////////////

  // Currently unused legacy variable; can remove later if not needed
  const symptomsList = useMemo(() => {
    if (!selectedConcern) return [];
    return getSymptomsForConcern(selectedConcern);
  }, [selectedConcern]);

  //////////////////////////
  // 8.8) Handlers — Step 1: Analyze free text (LLM)
  //////////////////////////

  const handleAnalyzeText = async () => {
    if (!freeText.trim()) return;
    setSystemPrompt("SYSTEM TEST");
    setLlmPrompt("USER TEST");
    
    setIsLoading(true);

    //////////////////////////////
    // 🧠 CHATGPT MODE SHORTCUT
    //////////////////////////////
    if (mode === 'chatgpt') {
      await handleChatGPTDirectAssessment();
      setIsLoading(false);
      setStep(4);
      return;
    }

    //////////////////////////////
    // 🏥 STANDARD INTAKE FLOW
    //////////////////////////////

    const payload: ConcernAnalyzeRequest = {
      freeTextConcern: freeText.trim(),
      locale: 'en-US',
    };

    try {
      const res = await fetch(`${API_BASE_URL}/v1/intake/concern-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error('API error:', res.status, await res.text());
        return;
      }

      const data = await res.json();
      console.log('Concern analyze response:', data);

setConcernSuggestions([
  data.primaryCategory,
  ...(data.candidateCategories || [])
]);

setClinicalSummary(data.clinicalSummary || null);

// NEW
if (data.transparency) {
  setLlmPrompt(data.transparency.userPrompt);
  setSystemPrompt(data.transparency.systemPrompt);
}

      const suggestions = [
        data.primaryCategory,
        ...(data.candidateCategories || []),
      ].filter(Boolean);

      setConcernSuggestions(suggestions);
      setClinicalSummary(data.clinicalSummary || null);
      setStep(1);
    } catch (err) {
      console.error('Network or parsing error', err);
    } finally {
      setIsLoading(false);
    }
  };

  //////////////////////////
  // 8.9) Handlers — Step 2: Select concern
  //////////////////////////

  const handleSelectConcern = (concern: string) => {
    setSelectedConcern(concern);
    const symptoms = getSymptomsForConcern(concern);
    setSymptomRatings(symptoms.map((s) => ({ symptom: s, severity: 0 })));
    setStep(3);
  };

  //////////////////////////////
  // ChatGPT Direct Assessment
  //////////////////////////////

  const handleChatGPTDirectAssessment = async () => {
    // Frontend mock (safe for now)

    const mockAssessment: RiskAssessment = {
      level: 'Moderate',
      concernType: 'General Health Concern',
      brief:
        'Your description suggests a moderate health concern that may require clinical evaluation.',
      redFlags: [],
      analysis:
        'Based on your symptoms, there are indicators that warrant medical attention. While some symptoms may be manageable with rest and monitoring, others suggest that a healthcare provider should evaluate your condition to rule out more serious causes.',
      recommendations: [
        'Schedule an appointment with a healthcare provider',
        'Monitor symptom progression',
        'Seek urgent care if symptoms worsen',
      ],
    };

    setRiskAssessment(mockAssessment);
  };

  //////////////////////////
  // 8.10) Handlers — Step 3: Update severity
  //////////////////////////

  const handleUpdateSeverity = (index: number, severity: number) => {
    const updated = [...symptomRatings];
    updated[index].severity = severity;
    setSymptomRatings(updated);
  };

  const [showFullPrompt, setShowFullPrompt] = useState(false);

  //////////////////////////
  // 8.11) Handlers — Step 4: Generate assessment (local + LLM)
  //////////////////////////

  const handleGenerateAssessment = async () => {
    if (!selectedConcern || symptomRatings.length === 0) return;

    setIsLoading(true);

    const localAssessment = analyzeRisk(selectedConcern, symptomRatings);

    const symptomSummary =
      symptomRatings
        .filter((r) => r.severity > 0)
        .map((r) => `${r.symptom} (${SEVERITY_LABELS[r.severity]})`)
        .join(', ') || 'No significant symptoms were rated.';

    const payload = {
      riskLevel: localAssessment.level,
      concernType: localAssessment.concernType,
      symptomSummary,
      redFlags: localAssessment.redFlags,
      recommendations: localAssessment.recommendations,
    };

    try {
      // LLM-generated final report text (Step 4)
      const res = await fetch(`${API_BASE_URL}/v1/intake/final-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error('Final report API error:', res.status, await res.text());
        setRiskAssessment(localAssessment);
        setStep(4);
        setLlmPrompt('');
        setSystemPrompt('');
        return;
      }

      const data = (await res.json()) as {
        riskLevel: 'Low' | 'Moderate' | 'High';
        concernType: string;
        summary: string;
        analysis: string;
        recommendations: string[];
        disclaimer: string;
        safetyNotes: string[];

        transparency?: {
          systemPrompt: string;
          userPrompt: string;
          model: string;
        };
      };

      const merged: RiskAssessment = {
        level: localAssessment.level,
        concernType: localAssessment.concernType,
        brief: data.summary || localAssessment.brief,
        redFlags: localAssessment.redFlags,
        analysis: data.analysis || localAssessment.analysis,
        recommendations: data.recommendations?.length ? data.recommendations : localAssessment.recommendations,
      };

      setRiskAssessment(merged);

      if (data.transparency) {
        setLlmPrompt(data.transparency.userPrompt);
        setSystemPrompt(data.transparency.systemPrompt);
      }

      // LLM-generated clinician questions (optional)
      if (clinicalSummary) {
        try {
          const qRes = await fetch(`${API_BASE_URL}/v1/intake/generate-questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concernType: selectedConcern, clinicalSummary }),
          });

          if (qRes.ok) {
            const qData = (await qRes.json()) as { questions: string[] };
            if (Array.isArray(qData.questions)) setDoctorQuestions(qData.questions);
          } else {
            console.error('Questions API error:', qRes.status, await qRes.text());
          }
        } catch (err) {
          console.error('Network error (generate-questions):', err);
        }
      } else {
        setDoctorQuestions([]);
      }

      setStep(4);
    } catch (err) {
      console.error('Network error (final-report):', err);
      setRiskAssessment(localAssessment);
      setStep(4);
    } finally {
      setIsLoading(false);
    }
  };

  //////////////////////////
  // 8.12) Handler — Reset flow
  //////////////////////////

  const handleReset = () => {
    setStep(1);
    setFreeText('');
    setConcernSuggestions([]);
    setSelectedConcern('');
    setSymptomRatings([]);
    setRiskAssessment(null);
    setClinicalSummary(null);
    setDoctorQuestions([]);
    setLlmPrompt('');
    setSystemPrompt('');
    setShowFullPrompt(false);

    // Optional: reset transparency toggles so Step 4 starts collapsed
    setShowDisclaimer(false);
    setShowHowGenerated(false);
    setShowSources(false);
    setShowAIBreakdown(false);
  };

  //////////////////////////
  // 9) Render
  //////////////////////////

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ThemedView style={styles.container}>
        {/* Header */}
        <ThemedView style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <ThemedText type="title" style={styles.headerTitle}>
          AI Symptom Review — Research Prototype
          </ThemedText>
          <ThemedText type="default" style={styles.headerSubtitle}>
  Step {step} of {TOTAL_STEPS}
</ThemedText>

<View style={styles.researchBadge}>
  <ThemedText style={styles.researchBadgeText}>
    Research Prototype — Educational Use Only
  </ThemedText>
</View>
          <ThemedText
  style={{
    fontSize: 12,
    color: '#92400E',
    marginTop: 4,
    fontWeight: '600',
  }}
>
  
</ThemedText>

          {/* Progress Indicator */}
          <View style={styles.progressContainer}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View key={i} style={styles.progressWrapper}>
                <View style={[styles.progressDot, i < step && styles.progressDotActive]} />
                {i < TOTAL_STEPS - 1 && (
                  <View style={[styles.progressLine, i < step - 1 && styles.progressLineActive]} />
                )}
              </View>
            ))}
          </View>
        </ThemedView>

        <ScrollView
  style={styles.content}
  contentContainerStyle={[
    styles.scrollContent,
    { paddingBottom: insets.bottom + 20 },
  ]}
  showsVerticalScrollIndicator={false}
>
  <View style={styles.workspace}>

    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        marginBottom: 16,
        justifyContent: 'center',
      }}
    >
      {(['control', 'high', 'chatgpt'] as TransparencyMode[]).map((m) => {
        const isActive = mode === m;

        return (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 20,
              backgroundColor: isActive ? '#3B82F6' : '#E5E7EB',
              borderWidth: 1,
              borderColor: isActive ? '#2563EB' : '#D1D5DB',
            }}
          >
            <ThemedText
              style={{
                color: isActive ? '#FFFFFF' : '#374151',
                fontWeight: '600',
                textTransform: 'capitalize',
              }}
            >
              {m}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>

{/* Step 1 — Combined Intake + Suggestions */}
{step === 1 && (
  <View style={styles.stepContainer}>

    <View style={styles.intakeWorkspace}>

      {/* LEFT — Intake */}
      <View style={styles.intakeLeft}>

        <ThemedText type="subtitle" style={styles.stepTitle}>
          Tell me what’s been going on with your health.
        </ThemedText>

        <ThemedText style={styles.dataNotice}>
          Your responses are used for research purposes and are not stored with identifying information.
        </ThemedText>

        <TextInput
          style={styles.textInput}
          value={freeText}
          onChangeText={setFreeText}
          placeholder="Describe your symptoms..."
          multiline
        />

        <Pressable
          style={styles.primaryButton}
          onPress={handleAnalyzeText}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <ThemedText style={styles.buttonText}>
              Analyze Symptoms
            </ThemedText>
          )}
        </Pressable>

        {/* Suggestions */}
        {concernSuggestions.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <ThemedText type="defaultSemiBold">
              Choose the most resonating suggested concern
            </ThemedText>

            {concernSuggestions.map((c, i) => (
              <Pressable
                key={i}
                onPress={() => handleSelectConcern(c)}
                style={styles.concernCard}
              >
                <ThemedText>{c}</ThemedText>
              </Pressable>
            ))}
          </View>
        )}

      </View>

      {/* RIGHT — Hierarchy Panel */}
      <View style={styles.intakeRight}>

<ThemedText style={styles.sourcesTitle}>
  Prompt Interpretation
</ThemedText>

{/* 1️⃣ LLM-Generated Setting Summary */}
<View style={{ marginBottom: 16 }}>
  <ThemedText style={{ fontWeight: '600', marginBottom: 4 }}>
    System Setting
  </ThemedText>

  <ThemedText style={{ fontSize: 13, opacity: 0.85 }}>
    {systemPrompt
      ? "This AI system is configured as a backend health education assistant. It summarizes user symptoms into structured clinical language while following predefined safety constraints."
      : "This system uses a language model configured as a backend health education assistant. It summarizes user symptoms into structured clinical-style output while following predefined safety constraints"}
  </ThemedText>
</View>

{/* Guardrails Toggle */}
<Pressable onPress={() => setShowGuardrails(v => !v)}>
  <ThemedText style={styles.expandButton}>
    {showGuardrails ? "Hide Guardrails ▲" : "View Guardrails ▼"}
  </ThemedText>
</Pressable>

{/* =========================
   Transparency Panel
========================= */}

{/* Guardrails / Safety Rules */}
{showGuardrails && (
  <View style={{ marginTop: 12 }}>

    <ThemedText style={{ fontWeight: '600', marginBottom: 6 }}>
      Safety Rules Applied
    </ThemedText>

    <View style={{ gap: 6 }}>
      <ThemedText style={styles.summaryText}>
        • The model is not allowed to generate diagnoses.
      </ThemedText>

      <ThemedText style={styles.summaryText}>
        • The model cannot recommend medications, dosages, or specific treatments.
      </ThemedText>

      <ThemedText style={styles.summaryText}>
        • The model cannot provide emergency triage decisions.
      </ThemedText>

      <ThemedText style={styles.summaryText}>
        • Outputs must remain educational and non-prescriptive.
      </ThemedText>
    </View>
  </View>
)}

{/* =========================
   TRANSPARENCY — TIER 1
========================= */}
<View style={{ marginTop: 16 }}>

<ThemedText style={{ fontWeight: '600', marginBottom: 6 }}>
  How your input was processed
</ThemedText>

<ThemedText style={styles.summaryText}>
  Your symptom description was analyzed to identify relevant
  medical themes and contextual severity cues.

  These findings were formatted into a structured clinical-style
  summary to support consistent evaluation.

  A rule-based risk model then estimated your concern level,
  while predefined safety guardrails prevented diagnostic or
  prescriptive outputs.
</ThemedText>

{/* =========================
   TRANSPARENCY — TIER 2
========================= */}

<Pressable onPress={() => setShowBreakdown(v => !v)}>
  <ThemedText style={styles.expandButton}>
    {showBreakdown
      ? "Hide Processing Logic Overview ▲"
      : "View Processing Logic Overview ▼"}
  </ThemedText>
</Pressable>

{showBreakdown && (
  <View style={{ marginTop: 12 }}>

<ThemedText style={{ fontWeight: '600', marginBottom: 4 }}>
What the system looked for in your response
</ThemedText>

<ThemedText style={styles.summaryText}>
• Specific symptoms you mentioned (e.g., chest pain, cough, nausea)
</ThemedText>

<ThemedText style={styles.summaryText}>
• Body areas affected
</ThemedText>

<ThemedText style={styles.summaryText}>
• Duration or timing clues (e.g., “since yesterday”)
</ThemedText>

<ThemedText style={styles.summaryText}>
• Words indicating intensity (e.g., severe, mild, worsening)
</ThemedText>


<ThemedText style={{ fontWeight: '600', marginTop: 12, marginBottom: 4 }}>
How your risk level was estimated
</ThemedText>

<ThemedText style={styles.summaryText}>
• You rated symptom severity using sliders
</ThemedText>

<ThemedText style={styles.summaryText}>
• The system applied predefined scoring thresholds
</ThemedText>

<ThemedText style={styles.summaryText}>
• Your overall score mapped to a Low, Moderate, or High concern level
</ThemedText>


<ThemedText style={{ fontWeight: '600', marginTop: 12, marginBottom: 4 }}>
Safety protections applied
</ThemedText>

<ThemedText style={styles.summaryText}>
• The system does not generate diagnoses
</ThemedText>

<ThemedText style={styles.summaryText}>
• The system does not recommend medications or dosages
</ThemedText>

<ThemedText style={styles.summaryText}>
• Emergency guidance is limited to general safety messaging
</ThemedText>

  </View>

)}
<Pressable onPress={() => setShowTranscript(v => !v)}>
  <ThemedText style={styles.expandButton}>
    {showTranscript
      ? "Hide Full Model Transcript ▲"
      : "View Full Model Transcript ▼"}
  </ThemedText>
</Pressable>

{showTranscript && (
  <View style={{ marginTop: 12 }}>

    {(systemPrompt || llmPrompt) ? (
      <>
        <ThemedText style={{ fontWeight: '600', marginBottom: 6 }}>
          System Configuration
        </ThemedText>

        <ThemedText style={styles.fullPrompt}>
          {systemPrompt || "Not returned by backend."}
        </ThemedText>

        <ThemedText style={{ fontWeight: '600', marginTop: 12, marginBottom: 6 }}>
          Prompt Sent to Model
        </ThemedText>

        <ThemedText style={styles.fullPrompt}>
          {llmPrompt || "Not returned by backend."}
        </ThemedText>
      </>
    ) : (
      <ThemedText style={styles.summaryText}>
        This prototype is not currently configured to display
        the full prompt transcript. Future versions may surface
        the exact model instructions and structured input sent
        to the AI system.
      </ThemedText>
    )}

  </View>
)}
</View>

{/* Raw Transcript (Advanced Toggle) */}
{(systemPrompt || llmPrompt) && (
  <>
    <Pressable onPress={() => setShowTranscript(v => !v)}>
      <ThemedText style={styles.expandButton}>
        {showTranscript ? "Hide Technical Prompt ▲" : "View Technical Prompt ▼"}
      </ThemedText>
    </Pressable>

    {showTranscript && (
      <View style={{ marginTop: 8 }}>
        <ThemedText style={styles.fullPrompt}>
          System Prompt:
          {"\n\n"}
          {systemPrompt || "Not returned by backend."}
          {"\n\n"}
          User Prompt:
          {"\n\n"}
          {llmPrompt || "Not returned by backend."}
        </ThemedText>
      </View>
    )}
  </>
)}        
          
          </View>  
    </View>   
  </View>     
)}



          {/* Step 3 — Symptom Sliders */}
          {step === 3 && (
            <View style={styles.stepContainer}>
              <ThemedText type="subtitle" style={styles.stepTitle}>
                {selectedConcern}
              </ThemedText>
              <ThemedText type="default" style={styles.stepDescription}>
                Rate the severity of each symptom you're experiencing:
              </ThemedText>

              <View style={styles.slidersList}>
                {symptomRatings.map((rating, index) => (
                  <View key={index} style={styles.sliderItem}>
                    <View style={styles.sliderHeader}>
                      <ThemedText type="defaultSemiBold" style={styles.sliderLabel}>
                        {rating.symptom}
                      </ThemedText>
                      <View
                        style={[
                          styles.severityBadge,
                          rating.severity === 0 && styles.severityNone,
                          rating.severity === 1 && styles.severityMild,
                          rating.severity === 2 && styles.severityModerate,
                          rating.severity === 3 && styles.severitySevere,
                        ]}
                      >
                        <ThemedText style={styles.severityBadgeText}>{SEVERITY_LABELS[rating.severity]}</ThemedText>
                      </View>
                    </View>

                    <Slider
                      style={styles.slider}
                      minimumValue={0}
                      maximumValue={3}
                      step={1}
                      value={rating.severity}
                      onValueChange={(value) => handleUpdateSeverity(index, value)}
                      minimumTrackTintColor="#3B82F6"
                      maximumTrackTintColor="#E5E7EB"
                      thumbTintColor="#3B82F6"
                    />
                  </View>
                ))}
              </View>

              <Pressable style={styles.primaryButton} onPress={handleGenerateAssessment} disabled={isLoading}>
                {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.buttonText}>Generate Assessment</ThemedText>}
              </Pressable>

              <Pressable style={styles.linkButton} onPress={() => setStep(1)}>
                <ThemedText style={styles.linkText}>← Change concern</ThemedText>
              </Pressable>
            </View>
          )}
















          {/* Step 4 — Assessment */}

{step === 4 && riskAssessment && (
  <View style={styles.stepContainer}>

    <ThemedText type="subtitle" style={styles.stepTitle}>
      Your Health Assessment
    </ThemedText>
    <View style={styles.noticeCard}>
    <View
  style={{
    backgroundColor: '#FEF3C7',
    padding: 14,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FCD34D',
  }}
>
  <ThemedText
    style={{
      fontSize: 13,
      color: '#92400E',
      fontWeight: '600',
    }}
  >
    Educational Decision-Support Tool — Not a Diagnosis
  </ThemedText>

  <ThemedText
    style={{
      fontSize: 12,
      color: '#78350F',
      marginTop: 4,
      lineHeight: 16,
    }}
  >
    This prototype summarizes symptom information for research
    purposes and does not replace professional medical evaluation.
  </ThemedText>
</View>
</View>

    <View
      style={[
        styles.riskBanner,
        riskAssessment.level === 'Low' && styles.riskLow,
        riskAssessment.level === 'Moderate' && styles.riskModerate,
        riskAssessment.level === 'High' && styles.riskHigh,
      ]}
    >
      {/* Emergency Escalation Banner */}
{riskAssessment.level === 'High' && (
  <View
    style={{
      backgroundColor: '#FEE2E2',
      borderColor: '#EF4444',
      borderWidth: 1,
      padding: 14,
      borderRadius: 10,
      marginTop: 12,
    }}
  >
    {riskAssessment.level === 'High' && (
  <View style={styles.emergencyBanner}>
    <ThemedText style={styles.emergencyTitle}>
      🚨 Immediate Attention Recommended
    </ThemedText>

    <ThemedText style={styles.emergencyText}>
      If symptoms are severe or worsening, contact emergency services or go to the nearest emergency department.
    </ThemedText>
  </View>
)}
    <ThemedText
      style={{
        color: '#991B1B',
        fontWeight: '700',
        marginBottom: 4,
      }}
    >
      🚨 Seek Immediate Medical Care
    </ThemedText>

    <ThemedText style={{ color: '#7F1D1D', fontSize: 13 }}>
      If you are experiencing severe or worsening symptoms,
      call 911 or go to the nearest emergency department immediately.
    </ThemedText>
  </View>
)}
      <ThemedText type="subtitle" style={styles.riskLevel}>
        Risk Level: {riskAssessment.level}
      </ThemedText>
      <ThemedText style={styles.riskConcern}>
        {riskAssessment.concernType}
      </ThemedText>
    </View>

{/* Summary */}
<View style={styles.analysisRow}>

  {/* LEFT COLUMN */}
  <View style={styles.analysisColumn}>

    {/* Summary */}
    <View style={styles.summarySection}>
      <ThemedText
        type="defaultSemiBold"
        style={styles.sectionTitle}
      >
        Summary
      </ThemedText>

      <ThemedText style={styles.summaryText}>
        {riskAssessment.brief}

        {isHighTransparency && (
          <ThemedText style={styles.citationTag}>
            {' '}[1]
          </ThemedText>
        )}
      </ThemedText>
    </View>

                  {/* Analysis */}
                  <View style={styles.summarySection}>
                    <ThemedText
                      type="defaultSemiBold"
                      style={styles.sectionTitle}
                    >
                      Analysis
                    </ThemedText>

                    <ThemedText style={styles.summaryText}>
  {riskAssessment.analysis.split('. ')[0]}.

  {isHighTransparency && (
    <ThemedText style={styles.citationTag}>
      {' '}[1]
    </ThemedText>
  )}

  {' '}
  {riskAssessment.analysis.split('. ').slice(1).join('. ')}
</ThemedText>
                  </View>

                </View>

                {/* RIGHT COLUMN — INLINE SOURCES */}
                {isHighTransparency && (
                  <View style={styles.sourcesColumn}>

                    <ThemedText style={styles.sourcesTitle}>
                      Evidence References
                    </ThemedText>

                    {getEvidenceSources(riskAssessment.concernType).map(
                      (source, index) => (
                        <View key={index} style={styles.sourceCard}>

<ThemedText style={styles.sourceTitle}>
  [{index + 1}] {source.title}
</ThemedText>

                          <ThemedText style={styles.sourceMeta}>
                            {source.organization} • {source.year}
                          </ThemedText>

                          <ThemedText style={styles.sourceRelevance}>
                            {source.relevance}
                          </ThemedText>

                        </View>
                      )
                    )}
                  </View>
                )}
              </View>

{/* Prompt Transparency Box */}
<View style={styles.promptBox}>

  <ThemedText style={styles.promptSummary}>
    This assessment was generated based on your symptoms,
    duration, and severity inputs.
  </ThemedText>

  <Pressable
    onPress={() => setShowFullPrompt(!showFullPrompt)}
  >
    <ThemedText style={styles.expandButton}>
      {showFullPrompt ? "Hide Full Prompt" : "View Full Prompt"}
    </ThemedText>
  </Pressable>

  {showFullPrompt && (
  <>
    <ThemedText style={{ fontWeight: '600', marginTop: 8 }}>
      System Guardrails
    </ThemedText>

    <ThemedText style={styles.fullPrompt}>
      {systemPrompt}
    </ThemedText>

    <ThemedText style={{ fontWeight: '600', marginTop: 12 }}>
      Prompt Sent to Model
    </ThemedText>

    <ThemedText style={styles.fullPrompt}>
      {llmPrompt}
    </ThemedText>
  </>
)}

</View>
              {/* Recommendations */}
              <View style={styles.summarySection}>
  <ThemedText
    type="defaultSemiBold"
    style={styles.sectionTitle}
  >
    Recommendations
  </ThemedText>

  {riskAssessment.recommendations.map((rec, index) => (
    <View key={index} style={styles.listItem}>
      <ThemedText style={styles.bullet}>•</ThemedText>
      <ThemedText style={styles.summaryText}>
        {rec}
      </ThemedText>
    </View>
  ))}
</View>

              {/* Doctor Questions */}
              {doctorQuestions.length > 0 && (
                <View style={styles.summarySection}>
                  <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>
                    Questions to ask your clinician
                  </ThemedText>
                  {doctorQuestions.map((q, index) => (
                    <View key={index} style={styles.listItem}>
                      <ThemedText style={styles.bullet}>•</ThemedText>
                      <ThemedText style={styles.summaryText}>{q}</ThemedText>
                    </View>
                  ))}
                </View>
              )}



              {/* Reasoning Cues — High Transparency Only */}




















              




              {/* =========================
        TRANSPARENCY PANELS
       ========================= */}

              {/* Medical Disclaimer — ALL MODES */}
              <View style={styles.disclaimer}>
                <Pressable onPress={() => setShowDisclaimer((v) => !v)}>
                  <ThemedText style={[styles.disclaimerText, { fontWeight: '600' }]}>
                    {showDisclaimer
                      ? 'Hide medical disclaimer ▲'
                      : 'Show medical disclaimer ▼'}
                  </ThemedText>
                </Pressable>

                {showDisclaimer && (
                  <View style={{ marginTop: 8 }}>
                    <ThemedText style={styles.disclaimerText}>
                      ⚕️ This assessment is for informational purposes only and does not
                      replace professional medical advice. Always consult a healthcare
                      provider for proper diagnosis and treatment.
                    </ThemedText>
                  </View>
                )}
              </View>

              {/* How Generated — HIGH ONLY */}
              {isHighTransparency && (
                <View style={styles.disclaimer}>
                  <Pressable
                    onPress={() => setShowHowGenerated((v) => !v)}
                  >
                    <ThemedText
                      style={[styles.disclaimerText, { fontWeight: '600' }]}
                    >
                      {showHowGenerated
                        ? 'Hide how this result was generated ▲'
                        : 'Show how this result was generated ▼'}
                    </ThemedText>
                  </Pressable>

                  {showHowGenerated && (
                    <View style={{ marginTop: 8 }}>
                      <ThemedText style={styles.disclaimerText}>
                        This summary was generated using a combination of AI
                        assistance and structured system logic.
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Your free-text description was analyzed by an AI language
                        model to identify relevant health topics and summarize
                        concerns in plain language.
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Risk level was estimated using predefined symptom scoring
                        rules implemented in code.
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Suggested questions were generated to help you prepare for
                        a discussion with a healthcare professional.
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        This system does not provide diagnoses and is intended only
                        to support information gathering before a clinical visit.
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}

              {/* Sources — HIGH ONLY */}
              {isHighTransparency && (
                <View style={styles.disclaimer}>
                  <Pressable onPress={() => setShowSources((v) => !v)}>
                    <ThemedText
                      style={[styles.disclaimerText, { fontWeight: '600' }]}
                    >
                      {showSources
                        ? 'Hide sources & citations ▲'
                        : 'Show sources & citations ▼'}
                    </ThemedText>
                  </Pressable>

                  {showSources && (
                    <View style={{ marginTop: 8 }}>
                      <ThemedText style={styles.disclaimerText}>
                        This response is based on general medical knowledge and
                        commonly accepted clinical guidance.
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        Example source categories include:
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Public health organizations (e.g., CDC, NIH)
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Peer-reviewed medical literature
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Clinical practice guidelines used for patient education
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        This prototype does not currently retrieve or verify live
                        citations. Sources are shown to illustrate how evidence
                        transparency could be surfaced in a future system.
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}

              {/* AI vs System — HIGH ONLY */}
              {isHighTransparency && (
                <View style={styles.disclaimer}>
                  <Pressable
                    onPress={() => setShowAIBreakdown((v) => !v)}
                  >
                    <ThemedText
                      style={[styles.disclaimerText, { fontWeight: '600' }]}
                    >
                      {showAIBreakdown
                        ? 'Hide AI vs system breakdown ▲'
                        : 'Show AI vs system breakdown ▼'}
                    </ThemedText>
                  </Pressable>



                  {showAIBreakdown && (
                    <View style={{ marginTop: 8 }}>
                      <ThemedText style={styles.disclaimerText}>
                        This result was produced using both AI assistance and
                        deterministic system logic.
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        AI-assisted components:
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Summarizing your free-text description into a clinical-style overview
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Generating suggested questions to discuss with a healthcare provider
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        System-controlled components:
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Symptom severity scoring based on predefined rules
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        • Risk level categorization using deterministic logic implemented in code
                      </ThemedText>

                      <ThemedText style={styles.disclaimerText}>
                        The AI model does not assign diagnoses or determine risk levels.
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}

              {/* Prototype actions */}
              <View style={styles.actionButtons}>
                <Pressable style={styles.secondaryButton}>
                  <ThemedText style={styles.secondaryButtonText}>
                    Find Clinics
                  </ThemedText>
                </Pressable>

                <Pressable style={styles.secondaryButton}>
                  <ThemedText style={styles.secondaryButtonText}>
                    Save Report
                  </ThemedText>
                </Pressable>
              </View>

              {/* Reset */}
              <Pressable
                style={styles.primaryButton}
                onPress={handleReset}
              >
                <ThemedText style={styles.buttonText}>
                  Start New Consultation
                </ThemedText>
              </Pressable>
            </View>
          )}
          </View>  
        </ScrollView>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}





















//////////////////////////////
// 10) Styles
//////////////////////////////

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F6FB', 
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { marginBottom: 4 },  headerSubtitle: { fontSize: 13, opacity: 0.6, marginBottom: 16 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  progressWrapper: { flexDirection: 'row', alignItems: 'center' },
  progressDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#D1D5DB' },
  progressDotActive: { backgroundColor: '#3B82F6' },
  progressLine: { width: 40, height: 2, backgroundColor: '#D1D5DB', marginHorizontal: 4 },
  progressLineActive: { backgroundColor: '#3B82F6' },
  content: { flex: 1 },
  scrollContent: { padding: 16 },
  stepContainer: {
    gap: 16,
    backgroundColor: '#FFFFFF',
    padding: 25,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  stepTitle: { fontSize: 20 },
  stepDescription: { opacity: 0.7, lineHeight: 20 },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    minHeight: 120,
    textAlignVertical: 'top',
    color: '#1F2937',
  },
  primaryButton: { backgroundColor: '#3B82F6', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#D1D5DB' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  concernList: { gap: 12 },
  concernCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  noticeCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  
  noticeText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  concernIcon: {
    width: 48,
    height: 48,
    backgroundColor: '#EFF6FF',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  concernEmoji: { fontSize: 24 },
  concernContent: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  concernArrow: { fontSize: 20, color: '#3B82F6' },
  linkButton: { paddingVertical: 8, alignItems: 'center' },
  linkText: { color: '#3B82F6', fontSize: 14 },
  slidersList: { gap: 20 },
  sliderItem: { gap: 8 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { fontSize: 15 },
  severityBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  severityNone: { backgroundColor: '#F3F4F6' },
  severityMild: { backgroundColor: '#FEF3C7' },
  severityModerate: { backgroundColor: '#FED7AA' },
  severitySevere: { backgroundColor: '#FEE2E2' },
  severityBadgeText: { fontSize: 12, fontWeight: '600' },
  slider: { width: '100%', height: 40 },
  riskBanner: { padding: 16, borderRadius: 12, borderWidth: 2 },
  riskLow: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
  riskModerate: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  riskHigh: { backgroundColor: '#FEE2E2', borderColor: '#EF4444' },
  riskLevel: { fontSize: 18, marginBottom: 4 },
  riskConcern: { fontSize: 14, opacity: 0.8 },
  sectionTitle: { fontSize: 15, marginBottom: 8 },
  summarySection: { padding: 16, backgroundColor: '#F9FAFB', borderRadius: 12 },
  summaryText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#4B5563',
    marginBottom: 6,
  },
  listItem: { flexDirection: 'row', marginBottom: 8 },
  bullet: { fontSize: 14, marginRight: 8, color: '#4B5563' },
  disclaimer: { padding: 16, backgroundColor: '#FEF3C7', borderRadius: 12 },
  disclaimerText: { fontSize: 13, lineHeight: 18, color: '#92400E' },
  actionButtons: { flexDirection: 'row', gap: 12 },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  analysisRow: {
    flexDirection: 'row',
    gap: 16,
  },

  analysisColumn: {
    flex: 2,
    gap: 16,
  },

  sourcesColumn: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  sourcesTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },

  sourceCard: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  citationTag: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 13,
  },
  researchBadge: {
    marginTop: 8,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  dataNotice: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  researchBadgeText: {
    fontSize: 12,
    color: '#1D4ED8',
    fontWeight: '600',
  },

  sourceTitle: {
    fontWeight: '600',
    fontSize: 13,
    marginBottom: 2,
  },

  sourceMeta: {
    fontSize: 12,
    opacity: 0.7,
  },

  intakeWorkspace: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    alignItems: 'flex-start',
    gap: 24,
  },
  workspace: {
    maxWidth: 1100,
    width: '100%',
    alignSelf: 'center',
  },
  intakeLeft: {
    flex: 2,
    minWidth: 500,
  },
  promptBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emergencyBanner: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#EF4444',
    backgroundColor: '#FEE2E2',
  },
  
  emergencyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 4,
  },
  
  emergencyText: {
    fontSize: 13,
    color: '#7F1D1D',
    lineHeight: 18,
  },
  promptSummary: {
    fontSize: 13,
    marginBottom: 8,
    color: '#374151',
  },
  
  expandButton: {
    color: '#1D4ED8',
    fontWeight: '500',
    fontSize: 13,
    marginTop: 6,
  },
  
  fullPrompt: {
    fontSize: 12,
    lineHeight: 18,
    color: '#111827',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  
  intakeRight: {
    flex: 1,
    minWidth: 320,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  

  sourceRelevance: {
    fontSize: 12,
    marginTop: 4,
  },
  secondaryButtonText: { color: '#4B5563', fontSize: 15, fontWeight: '600' },
});

import React, { useState, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Mail, Send, FileText, Sparkles, Clock, CheckCircle2, XCircle, 
  AlertCircle, LogOut, ShieldCheck, Upload, Trash2, RefreshCw, 
  Users, Layers, ExternalLink, Settings, Check
} from "lucide-react";
import { toast } from "sonner";
import { startLogin } from "@/const";

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState("compose");

  // State for compose campaign
  const [title, setTitle] = useState("Software Engineer Application");
  const [subject, setSubject] = useState("Application for Software Engineer Role - Resume Attached");
  const [bodyTemplate, setBodyTemplate] = useState(
    `<p>Dear Hiring Manager,</p>\n\n<p>I hope this email finds you well. I am writing to express my strong interest in the open engineering position at your esteemed company.</p>\n\n<p>Please find my resume attached to this email for your review. I would welcome the opportunity to discuss how my technical skills can contribute to your team.</p>\n\n<p>Best regards,<br/><strong>{{name}}</strong></p>`
  );
  const [recipientsText, setRecipientsText] = useState("");
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);

  // AI Assistant Modal State
  const [aiOpen, setAiOpen] = useState(false);
  const [jobTitle, setJobTitle] = useState("Senior Full-Stack Developer");
  const [companyName, setCompanyName] = useState("TechCorp Inc.");
  const [tone, setTone] = useState("Professional & Confident");
  const [keyPoints, setKeyPoints] = useState("5+ years experience in React, Node.js, Cloud architecture");
  const [isGenerating, setIsGenerating] = useState(false);

  // Google consent dialog
  const [googleModalOpen, setGoogleModalOpen] = useState(false);

  // Selected campaign detail modal
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // Queries with auto-polling for campaign status updates
  const { data: googleStatus, refetch: refetchGoogle } = trpc.google.status.useQuery(undefined, { enabled: isAuthenticated });
  const { data: resumes = [], refetch: refetchResumes } = trpc.resumes.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: campaigns = [], refetch: refetchCampaigns } = trpc.campaigns.list.useQuery(undefined, { 
    enabled: isAuthenticated,
    refetchInterval: 5000, // Poll every 5s for real-time campaign status
  });
  const { data: campaignDetail } = trpc.campaigns.getDetail.useQuery(
    { id: selectedCampaignId! },
    { 
      enabled: !!selectedCampaignId,
      refetchInterval: 3000, // Poll detail logs when open
    }
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    const gmailError = params.get("google_error");
    if (gmailStatus === "connected") {
      toast.success("Gmail was connected securely. You can now create campaigns.");
      refetchGoogle();
    }
    if (gmailError) toast.error(gmailError);
    if (gmailStatus || gmailError) window.history.replaceState({}, "", window.location.pathname);
  }, [refetchGoogle]);

  // Mutations
  const disconnectGoogleMutation = trpc.google.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Google account unlinked");
      refetchGoogle();
    },
  });

  const uploadResumeMutation = trpc.resumes.upload.useMutation({
    onSuccess: (data) => {
      toast.success("Resume uploaded and stored securely on S3!");
      refetchResumes();
      if (data.resumeId) setSelectedResumeId(data.resumeId);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteResumeMutation = trpc.resumes.delete.useMutation({
    onSuccess: () => {
      toast.success("Resume deleted");
      refetchResumes();
    },
  });

  const createCampaignMutation = trpc.campaigns.createAndSend.useMutation({
    onSuccess: (data) => {
      if (data.status === 'scheduled') {
        toast.success("Campaign scheduled successfully for future delivery!");
      } else {
        toast.success("Bulk campaign started! Emails are being dispatched via Gmail API.");
      }
      refetchCampaigns();
      setActiveTab("history");
    },
    onError: (err) => toast.error(err.message),
  });

  const aiGenerateMutation = trpc.ai.generateEmail.useMutation({
    onSuccess: (data) => {
      setSubject(data.subject);
      setBodyTemplate(data.body);
      setAiOpen(false);
      setIsGenerating(false);
      toast.success("AI generated tailored email body successfully!");
    },
    onError: (err) => {
      setIsGenerating(false);
      toast.error(err.message);
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.pdf') && !file.name.endsWith('.docx')) {
      toast.error("Only PDF and DOCX resume formats are supported.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      uploadResumeMutation.mutate({
        filename: file.name,
        base64Data: base64,
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
  };

  const startGoogleAuthorization = () => {
    if (!googleStatus?.configured) {
      toast.error("Gmail connection still needs the app's Google OAuth credentials. No email will be sent until that one-time setup is complete.");
      return;
    }
    window.location.assign("/api/google/connect");
  };

  const handleSendCampaign = () => {
    if (!googleStatus?.connected) {
      toast.error("Please connect your Google account via Gmail API first!");
      setGoogleModalOpen(true);
      return;
    }
    if (!title.trim() || !subject.trim() || !bodyTemplate.trim()) {
      toast.error("Please fill in campaign title, subject, and message body.");
      return;
    }

    const recipientList = recipientsText
      .split(/[\n,]/)
      .map(e => e.trim())
      .filter(e => e.length > 0 && e.includes("@"));

    if (recipientList.length === 0) {
      toast.error("Please enter at least one valid recipient email address.");
      return;
    }

    createCampaignMutation.mutate({
      title,
      subject,
      bodyTemplate,
      resumeId: selectedResumeId,
      recipients: recipientList,
      scheduledAt: isScheduled && scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-indigo-500/30">
            <Mail className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Bulk Resume & Email Sender Pro</h1>
          <p className="text-slate-400 text-sm mb-8 leading-relaxed">
            Send personalized bulk emails and resumes with Gmail API, AI drafting assistance, S3 resume attachments, and cron scheduling.
          </p>
          <Button 
            onClick={() => startLogin()} 
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-6 rounded-xl shadow-lg shadow-indigo-600/25 transition-all"
          >
            Sign in to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-md shadow-indigo-600/30">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-none tracking-tight">Bulk Resume Sender Pro</h1>
            <p className="text-xs text-slate-400 mt-1">Gmail API & S3 Powered Outreach</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {googleStatus?.connected ? (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full text-xs text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>{googleStatus.email}</span>
              <button 
                onClick={() => disconnectGoogleMutation.mutate()} 
                className="ml-2 hover:text-red-400 underline text-[10px]"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setGoogleModalOpen(true)}
              className="border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 text-xs"
            >
              <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
              Connect Gmail
            </Button>
          )}

          <div className="h-6 w-px bg-slate-800" />

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-300 font-medium hidden sm:inline">{user?.name || user?.email}</span>
            <Button variant="ghost" size="icon" onClick={() => logout()} className="text-slate-400 hover:text-white">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-slate-900 border border-slate-800 p-1 rounded-xl">
            <TabsTrigger value="compose" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
              <Send className="w-4 h-4 mr-2" />
              Compose & Send
            </TabsTrigger>
            <TabsTrigger value="resumes" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Resume Storage ({resumes.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
              <Layers className="w-4 h-4 mr-2" />
              Campaign History ({campaigns.length})
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: COMPOSE & SEND */}
          <TabsContent value="compose" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
                  <CardHeader className="flex flex-row items-center justify-between pb-4">
                    <div>
                      <CardTitle className="text-lg">Campaign Details</CardTitle>
                      <CardDescription className="text-slate-400">Configure your bulk outreach campaign and template</CardDescription>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setAiOpen(true)}
                      className="border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
                    >
                      <Sparkles className="w-4 h-4 mr-1.5 text-indigo-400" />
                      AI Email Assistant
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-300">Campaign Title</label>
                        <Input 
                          value={title} 
                          onChange={e => setTitle(e.target.value)} 
                          className="bg-slate-950 border-slate-800 text-white" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-300">Email Subject</label>
                        <Input 
                          value={subject} 
                          onChange={e => setSubject(e.target.value)} 
                          className="bg-slate-950 border-slate-800 text-white" 
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-300">Email Body (HTML Supported)</label>
                        <span className="text-[11px] text-slate-500">Use <code className="text-indigo-400">&#123;&#123;name&#125;&#125;</code> for personalization</span>
                      </div>
                      <Textarea 
                        rows={8}
                        value={bodyTemplate} 
                        onChange={e => setBodyTemplate(e.target.value)} 
                        className="bg-slate-950 border-slate-800 text-white font-mono text-xs" 
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Users className="w-5 h-5 text-indigo-400" />
                      Recipient Email Addresses
                    </CardTitle>
                    <CardDescription className="text-slate-400">Enter multiple email addresses separated by commas or newlines</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea 
                      rows={5}
                      placeholder="hr@company1.com, recruiter@company2.com&#10;talent@company3.com"
                      value={recipientsText}
                      onChange={e => setRecipientsText(e.target.value)}
                      className="bg-slate-950 border-slate-800 text-white font-mono text-xs"
                    />
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Parsed Recipients: {recipientsText.split(/[\n,]/).filter(e => e.trim().includes("@")).length}</span>
                      <Button variant="ghost" size="sm" onClick={() => setRecipientsText("")} className="text-slate-400 hover:text-white h-auto p-0 text-xs">
                        Clear all
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileText className="w-5 h-5 text-indigo-400" />
                      Resume Attachment
                    </CardTitle>
                    <CardDescription className="text-slate-400">Select resume to attach to all outgoing emails</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {resumes.length === 0 ? (
                      <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl p-4">
                        <p className="text-xs text-slate-400 mb-3">No resumes uploaded yet.</p>
                        <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2 rounded-lg font-medium shadow inline-flex items-center gap-2">
                          <Upload className="w-3.5 h-3.5" />
                          Upload Resume
                          <input type="file" accept=".pdf,.docx" onChange={handleFileUpload} className="hidden" />
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <Select 
                          value={selectedResumeId ? selectedResumeId.toString() : ""} 
                          onValueChange={(val) => setSelectedResumeId(Number(val))}
                        >
                          <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                            <SelectValue placeholder="Select resume..." />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-800 text-white">
                            {resumes.map(r => (
                              <SelectItem key={r.id} value={r.id.toString()}>{r.filename}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <label className="cursor-pointer w-full border border-dashed border-slate-800 hover:border-indigo-500/50 rounded-xl p-3 text-center block text-xs text-slate-400 transition-all">
                          <Upload className="w-4 h-4 mx-auto mb-1 text-indigo-400" />
                          Upload Another Resume
                          <input type="file" accept=".pdf,.docx" onChange={handleFileUpload} className="hidden" />
                        </label>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Clock className="w-5 h-5 text-indigo-400" />
                      Schedule & Dispatch
                    </CardTitle>
                    <CardDescription className="text-slate-400">Send immediately or schedule for future delivery</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                      <span className="text-xs font-medium text-slate-300">Schedule for later</span>
                      <input 
                        type="checkbox" 
                        checked={isScheduled} 
                        onChange={e => setIsScheduled(e.target.checked)} 
                        className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                      />
                    </div>

                    {isScheduled && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-slate-300">Execution Date & Time</label>
                        <Input 
                          type="datetime-local" 
                          value={scheduledAt} 
                          onChange={e => setScheduledAt(e.target.value)} 
                          className="bg-slate-950 border-slate-800 text-white text-xs" 
                        />
                      </div>
                    )}

                    <Button 
                      onClick={handleSendCampaign}
                      disabled={createCampaignMutation.isPending}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-6 rounded-xl shadow-lg shadow-indigo-600/30"
                    >
                      {createCampaignMutation.isPending ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Processing Campaign...
                        </>
                      ) : isScheduled ? (
                        <>
                          <Clock className="w-4 h-4 mr-2" />
                          Schedule Bulk Campaign
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Send Bulk Emails Now
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: RESUME STORAGE */}
          <TabsContent value="resumes" className="space-y-6">
            <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Uploaded Resumes (S3 Storage)</CardTitle>
                  <CardDescription className="text-slate-400">Manage your PDF and DOCX resume attachments</CardDescription>
                </div>
                <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2.5 rounded-xl font-medium shadow inline-flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Resume
                  <input type="file" accept=".pdf,.docx" onChange={handleFileUpload} className="hidden" />
                </label>
              </CardHeader>
              <CardContent>
                {resumes.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                    <p className="text-sm">No resumes uploaded yet.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {resumes.map(resume => (
                      <div key={resume.id} className="py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-600/10 text-indigo-400 rounded-xl flex items-center justify-center border border-indigo-500/20">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-medium text-sm text-white">{resume.filename}</p>
                            <p className="text-xs text-slate-400">Uploaded on {new Date(resume.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <a 
                            href={resume.fileUrl} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-xs text-indigo-400 hover:underline inline-flex items-center gap-1"
                          >
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => deleteResumeMutation.mutate({ id: resume.id })}
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: CAMPAIGN HISTORY */}
          <TabsContent value="history" className="space-y-6">
            <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Campaign History & Live Logs</CardTitle>
                  <CardDescription className="text-slate-400">Track real-time delivery status and recipient performance</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchCampaigns()} className="border-slate-800 text-slate-300">
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {campaigns.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <Layers className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                    <p className="text-sm">No campaigns executed yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {campaigns.map(camp => (
                      <div key={camp.id} className="bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold text-white">{camp.title}</h3>
                            <Badge className={
                              camp.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                              camp.status === 'sending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse' :
                              camp.status === 'scheduled' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' :
                              'bg-slate-800 text-slate-300'
                            }>
                              {camp.status.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-400">Subject: <span className="text-slate-300">{camp.subject}</span></p>
                          <p className="text-[11px] text-slate-500">Created: {new Date(camp.createdAt).toLocaleString()}</p>
                        </div>

                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Recipients</p>
                            <p className="font-semibold text-white">{camp.sentCount} / {camp.totalRecipients}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-400">Failures</p>
                            <p className="font-semibold text-red-400">{camp.failedCount}</p>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setSelectedCampaignId(camp.id)}
                            className="border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
                          >
                            Live Logs
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* AI Assistant Dialog */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              AI Email Assistant
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300">Target Job Title</label>
              <Input 
                value={jobTitle} 
                onChange={e => setJobTitle(e.target.value)} 
                className="bg-slate-950 border-slate-800 text-white" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300">Company Name</label>
              <Input 
                value={companyName} 
                onChange={e => setCompanyName(e.target.value)} 
                className="bg-slate-950 border-slate-800 text-white" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300">Tone</label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-white">
                  <SelectItem value="Professional & Confident">Professional & Confident</SelectItem>
                  <SelectItem value="Short & Direct">Short & Direct</SelectItem>
                  <SelectItem value="Warm & Enthusiastic">Warm & Enthusiastic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300">Key Highlights / Skills</label>
              <Textarea 
                rows={3}
                value={keyPoints} 
                onChange={e => setKeyPoints(e.target.value)} 
                className="bg-slate-950 border-slate-800 text-white text-xs" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button 
              onClick={() => {
                setIsGenerating(true);
                aiGenerateMutation.mutate({ jobTitle, companyName, tone, keyPoints });
              }}
              disabled={isGenerating}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {isGenerating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Generate Tailored Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Google OAuth consent dialog */}
      <Dialog open={googleModalOpen} onOpenChange={setGoogleModalOpen}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              Connect Gmail securely
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-slate-400 leading-relaxed">
              You will be redirected to Google to choose an account and grant only the Gmail sending permission. This app never asks for your Google password or a pasted access token.
            </p>
            {!googleStatus?.configured && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                The app owner must add the Google OAuth Client ID and Client Secret before Gmail authorization can begin. The rest of the dashboard remains available.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button 
              onClick={startGoogleAuthorization}
              disabled={!googleStatus?.configured}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              Continue with Google
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Campaign Detail / Recipient Log Dialog */}
      <Dialog open={!!selectedCampaignId} onOpenChange={() => setSelectedCampaignId(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">Campaign Delivery Live Logs</DialogTitle>
          </DialogHeader>
          {campaignDetail && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <p className="font-semibold text-white text-base">{campaignDetail.campaign.title}</p>
                <p className="text-xs text-slate-400">Subject: {campaignDetail.campaign.subject}</p>
                <div className="flex gap-4 pt-2 text-xs">
                  <span className="text-emerald-400">Sent: {campaignDetail.campaign.sentCount}</span>
                  <span className="text-red-400">Failed: {campaignDetail.campaign.failedCount}</span>
                  <span className="text-slate-400">Total: {campaignDetail.campaign.totalRecipients}</span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recipient Status</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                  {campaignDetail.recipients.map(rec => (
                    <div key={rec.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {rec.status === 'sent' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : rec.status === 'failed' ? (
                          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <span className="font-mono text-white">{rec.email}</span>
                      </div>
                      <div className="text-right">
                        <Badge className={
                          rec.status === 'sent' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                          rec.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                          'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }>
                          {rec.status.toUpperCase()}
                        </Badge>
                        {rec.errorMessage && <p className="text-[10px] text-red-400 mt-1 max-w-xs truncate">{rec.errorMessage}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

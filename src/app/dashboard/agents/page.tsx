"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, Edit2, Info, Save, RefreshCw, AlertTriangle } from "lucide-react";
import { createPersonaAction, deletePersonaAction, fetchPersonasAction, updatePersonaAction } from "../settings/actions";

const SYSTEM_AGENTS_DEFAULTS = [
  {
    name: "System - Analyst",
    defaultPrompt: "You are an elite Data & Audience Analyst. Extract the psychographic profile and core value proposition."
  },
  {
    name: "System - SEO",
    defaultPrompt: "You are a YouTube SEO Director. Write the perfect SEO description and tags."
  },
  {
    name: "System - Visuals",
    defaultPrompt: "You are a YouTube Art Director. Generate 3 extremely punchy thumbnail text options (2-4 words max) that create synergy and curiosity."
  }
];

export default function AgentsPage() {
  const [personas, setPersonas] = useState<any[]>([]);
  const [newPersona, setNewPersona] = useState({ name: "", provider: "openai", model: "gpt-4o", system_prompt: "" });
  const [savingPersona, setSavingPersona] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRecycleBin, setShowRecycleBin] = useState(false);

  useEffect(() => {
    fetchPersonas();
  }, []);

  const fetchPersonas = async () => {
    const res = await fetchPersonasAction();
    if (res.success && res.data) {
      setPersonas(res.data);
    }
  };

  const savePersona = async () => {
    if (!newPersona.name || !newPersona.system_prompt) return;
    setSavingPersona(true);
    
    try {
      let res;
      if (editingId) {
        res = await updatePersonaAction(editingId, {
          name: newPersona.name,
          provider: newPersona.provider,
          model: newPersona.model,
          system_prompt: newPersona.system_prompt
        });
      } else {
        res = await createPersonaAction(newPersona);
      }

      if (res?.error) {
        alert("Error saving agent: " + res.error);
      } else {
        resetForm();
        fetchPersonas();
      }
    } catch (e: any) {
      console.error(e);
      alert("Failed to connect to the server. Please refresh the page and try again.");
    }

    setSavingPersona(false);
  };

  // SOFT DELETE
  const moveToRecycleBin = async (persona: any) => {
    if (persona.name.startsWith("[DELETED]")) return;
    await updatePersonaAction(persona.id, { name: `[DELETED] ${persona.name}` });
    if (editingId === persona.id) resetForm();
    fetchPersonas();
  };

  // RESTORE
  const restorePersona = async (persona: any) => {
    const restoredName = persona.name.replace("[DELETED] ", "");
    const res = await updatePersonaAction(persona.id, { name: restoredName });
    if (res?.error) {
      alert(`Restore failed: an agent named "${restoredName}" already exists. Rename or permanently delete it first.`);
      return;
    }
    fetchPersonas();
  };

  // HARD DELETE
  const permanentlyDeletePersona = async (id: string) => {
    if (confirm("Are you sure you want to permanently delete this agent? This cannot be undone.")) {
      await deletePersonaAction(id);
      fetchPersonas();
    }
  };

  const handleEdit = (persona: any) => {
    setEditingId(persona.id);
    setNewPersona({
      name: persona.name,
      provider: persona.provider,
      model: persona.model,
      system_prompt: persona.system_prompt
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleOverrideSystem = (agentName: string, defaultPrompt: string) => {
    setEditingId(null);
    setNewPersona({
      name: agentName,
      provider: "openai",
      model: "gpt-4o-mini",
      system_prompt: defaultPrompt
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setEditingId(null);
    setNewPersona({ name: "", provider: "openai", model: "gpt-4o", system_prompt: "" });
  };

  const deletedPersonas = personas.filter(p => p.name.startsWith("[DELETED]"));
  const activePersonas = personas.filter(p => !p.name.startsWith("[DELETED]"));
  
  const userPersonas = activePersonas.filter(p => !p.name.startsWith("System -"));
  const activeSystemPersonas = activePersonas.filter(p => p.name.startsWith("System -"));

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">AI Team & Personas</h2>
          <p className="text-gray-500">Manage your virtual agency's creative directors and backend operational agents.</p>
        </div>
        <Button variant={showRecycleBin ? "default" : "outline"} onClick={() => setShowRecycleBin(!showRecycleBin)}>
          <Trash2 className="w-4 h-4 mr-2" />
          Recycle Bin ({deletedPersonas.length})
        </Button>
      </div>

      {showRecycleBin && (
        <Card className="border-orange-200 bg-orange-50/50 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-orange-900 flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2 text-orange-500" />
              Recycle Bin
            </CardTitle>
            <CardDescription>Deleted agents are kept here. You can restore them or permanently delete them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deletedPersonas.length === 0 && <p className="text-sm text-gray-500 italic">Recycle bin is empty.</p>}
            {deletedPersonas.map(p => (
              <div key={p.id} className="p-3 border rounded-md bg-white opacity-70 hover:opacity-100 transition-opacity relative group">
                <div className="flex justify-between items-start">
                  <div className="pr-16">
                    <h5 className="font-bold text-sm text-gray-500 line-through">{p.name.replace("[DELETED] ", "")}</h5>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider">{p.provider} • {p.model}</p>
                  </div>
                  <div className="absolute top-3 right-3 flex gap-2">
                    <button onClick={() => restorePersona(p)} className="text-green-600 hover:text-green-800 transition-colors p-1 flex items-center text-xs bg-green-50 rounded px-2" title="Restore">
                      <RefreshCw className="w-3 h-3 mr-1" /> Restore
                    </button>
                    <button onClick={() => permanentlyDeletePersona(p.id)} className="text-red-500 hover:text-red-700 transition-colors p-1 flex items-center text-xs bg-red-50 rounded px-2" title="Permanently Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2 line-clamp-1">{p.system_prompt}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* LEFT COLUMN: Create Form */}
        <Card className="h-fit border-indigo-100 shadow-sm sticky top-24">
          <CardHeader>
            <CardTitle>{editingId ? "Edit AI Agent" : "Create AI Agent"}</CardTitle>
            <CardDescription>{editingId ? "Update existing agent instructions." : "Add a new creative director or override a system agent."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Agent Name</Label>
              <Input 
                placeholder="e.g. Master Copywriter" 
                value={newPersona.name} 
                onChange={e => setNewPersona({...newPersona, name: e.target.value})} 
                disabled={newPersona.name.startsWith("System -")} // Don't allow renaming if it's a system override
              />
              {newPersona.name.startsWith("System -") && (
                <p className="text-xs text-blue-500">You are editing a backend agent.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <select 
                  className="w-full border rounded-md p-2 text-sm"
                  value={newPersona.provider} 
                  onChange={e => setNewPersona({...newPersona, provider: e.target.value, model: e.target.value === 'openai' ? 'gpt-4o' : e.target.value === 'anthropic' ? 'claude-3-5-sonnet-20240620' : 'gemini-1.5-pro'})}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Input value={newPersona.model} onChange={e => setNewPersona({...newPersona, model: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>System Prompt (Instructions)</Label>
              <textarea 
                className="w-full min-h-[150px] p-2 border rounded-md text-sm"
                placeholder="You are an expert..."
                value={newPersona.system_prompt}
                onChange={e => setNewPersona({...newPersona, system_prompt: e.target.value})}
              />
            </div>
            
            <div className="flex gap-2">
              <Button onClick={savePersona} disabled={savingPersona || !newPersona.name} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
                {editingId ? <Save className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />} 
                {editingId ? "Save Changes" : "Save Agent"}
              </Button>
              {(newPersona.name || editingId) && (
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* RIGHT COLUMN: Lists */}
        <div className="space-y-6">
          
          {/* USER PERSONAS */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Your Creative Directors</CardTitle>
              <CardDescription>These personas can be selected in the New Video dashboard to guide the vibe.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {userPersonas.length === 0 && <p className="text-sm text-gray-500 italic">No custom directors yet.</p>}
              {userPersonas.map(p => (
                <div key={p.id} className="p-3 border rounded-md bg-white hover:border-gray-300 transition-colors relative group">
                  <div className="flex justify-between items-start">
                    <div className="pr-12">
                      <h5 className="font-bold text-sm text-gray-800">{p.name}</h5>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{p.provider} • {p.model}</p>
                    </div>
                    <div className="absolute top-3 right-3 flex gap-2">
                      <button onClick={() => handleEdit(p)} className="text-blue-500 hover:text-blue-700 transition-colors p-1" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => moveToRecycleBin(p)} className="text-red-400 hover:text-red-600 transition-colors p-1" title="Move to Recycle Bin">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-2 line-clamp-2">{p.system_prompt}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* SYSTEM AGENTS */}
          <Card className="border-blue-200 bg-blue-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-blue-900 flex items-center">
                System Agents (Backend)
                <Info className="w-4 h-4 ml-2 text-blue-500" />
              </CardTitle>
              <CardDescription>These agents run automatically in the background pipeline.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {SYSTEM_AGENTS_DEFAULTS.map(sys => {
                const isOverridden = activeSystemPersonas.find(p => p.name === sys.name);
                
                return (
                  <div key={sys.name} className={`p-3 border rounded-md transition-all relative ${isOverridden ? 'bg-white border-green-300 shadow-sm' : 'bg-gray-50 border-gray-200 border-dashed opacity-80 hover:opacity-100'}`}>
                    <div className="flex justify-between items-start">
                      <div className="pr-12">
                        <h5 className={`font-bold text-sm ${isOverridden ? 'text-green-700' : 'text-gray-700'}`}>
                          {sys.name}
                        </h5>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                          {isOverridden ? `${isOverridden.provider} • ${isOverridden.model}` : 'Default (Hardcoded gpt-4o-mini)'}
                        </p>
                      </div>
                      
                      <div className="absolute top-3 right-3 flex gap-2">
                        {isOverridden ? (
                          <>
                            <button onClick={() => handleEdit(isOverridden)} className="text-blue-500 hover:text-blue-700 transition-colors p-1" title="Edit Override">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => moveToRecycleBin(isOverridden)} className="text-red-500 hover:text-red-700 transition-colors p-1" title="Delete Override">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleOverrideSystem(sys.name, sys.defaultPrompt)} className="text-blue-600 hover:text-blue-800 flex items-center text-xs font-medium bg-blue-100 px-2 py-1 rounded transition-colors" title="Create Override">
                            <Edit2 className="w-3 h-3 mr-1" /> Edit
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-600 mt-2 line-clamp-2 font-mono">
                      {isOverridden ? isOverridden.system_prompt : sys.defaultPrompt}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* SOCIAL MEDIA SQUAD */}
          <Card className="border-pink-200 bg-pink-50/30 mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg text-pink-900 flex items-center">
                Social Media Squad (Post-Processing)
                <Info className="w-4 h-4 ml-2 text-pink-500" />
              </CardTitle>
              <CardDescription>Create agents starting with "Social - " to automatically write multi-platform posts after the video is processed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {personas.filter(p => p.name.startsWith("Social - ") && !p.name.startsWith("[DELETED]")).length === 0 && (
                <p className="text-sm text-gray-500 italic">No social media agents created yet. Try creating "Social - TikTok"!</p>
              )}
              {personas.filter(p => p.name.startsWith("Social - ") && !p.name.startsWith("[DELETED]")).map(p => (
                <div key={p.id} className="p-3 border border-pink-100 rounded-md bg-white hover:border-pink-300 transition-colors relative group shadow-sm">
                  <div className="flex justify-between items-start">
                    <div className="pr-12">
                      <h5 className="font-bold text-sm text-pink-800">{p.name}</h5>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{p.provider} • {p.model}</p>
                    </div>
                    <div className="absolute top-3 right-3 flex gap-2">
                      <button onClick={() => handleEdit(p)} className="text-blue-500 hover:text-blue-700 transition-colors p-1" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => moveToRecycleBin(p)} className="text-red-400 hover:text-red-600 transition-colors p-1" title="Move to Recycle Bin">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-2 line-clamp-2 font-mono">{p.system_prompt}</p>
                </div>
              ))}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}

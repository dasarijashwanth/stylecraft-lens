"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function NewProjectPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Form Fields State
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("grooming");
  const [targetMarket, setTargetMarket] = useState<"pro" | "consumer" | "both">("both");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [pricePoint, setPricePoint] = useState("");
  
  // Advanced / Precision fields
  const [companyContext, setCompanyContext] = useState("");
  const [motorTech, setMotorTech] = useState("");
  const [keyDiff, setKeyDiff] = useState("");

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};
    if (!name.trim()) errs.name = "Project name is required";
    if (!productName.trim()) errs.productName = "Product name is required";
    if (!description.trim()) {
      errs.description = "Product description is required";
    } else if (description.length < 10) {
      errs.description = "Add at least 10 characters for sharper results";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          industry,
          targetMarket,
          productName: productName.trim(),
          description: description.trim(),
          category: category.trim() || undefined,
          pricePoint: pricePoint.trim() || undefined,
          companyContext: companyContext.trim() || undefined,
          motorTech: motorTech || undefined,
          keyDiff: keyDiff.trim() || undefined,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      toast.success("Project created");
      router.push(`/dashboard/projects/${data.project.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <div>
        <button
          onClick={() => router.push("/dashboard/projects")}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to projects</span>
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-display">Create new project</h1>
        <p className="text-xs text-text-muted">
          Define your product offering and market context to align AI competitor analyses.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 text-xs">
        
        {/* CARD 1: Core Details */}
        <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-text-primary">Core project details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Project Name */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Project Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Apex Clipper launch"
                className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent ${
                  errors.name ? "border-danger" : "border-border"
                }`}
              />
              {errors.name && <p className="text-[10px] text-danger">{errors.name}</p>}
            </div>

            {/* Product Name */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Product Name *</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Apex Cordless Clipper"
                className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted focus:border-accent ${
                  errors.productName ? "border-danger" : "border-border"
                }`}
              />
              {errors.productName && <p className="text-[10px] text-danger">{errors.productName}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Industry selection */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Industry *</label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              >
                <option value="grooming">Grooming & Barbering</option>
                <option value="haircare">Hair Care & Styling</option>
                <option value="beauty">Beauty & Cosmetics</option>
                <option value="fashion">Fashion & Apparel</option>
                <option value="other">Other Creative Field</option>
              </select>
            </div>

            {/* Target market segmented buttons */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block mb-1">Target Market *</label>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-surface-1 border border-border">
                {[
                  { key: "pro", label: "Pro / Salon" },
                  { key: "consumer", label: "Consumer" },
                  { key: "both", label: "Both" }
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTargetMarket(opt.key as any)}
                    className={`py-1.5 rounded-md text-[10px] font-bold transition-all ${
                      targetMarket === opt.key 
                        ? "bg-surface-3 text-text-primary border border-border-strong shadow-sm" 
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product Description */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="font-semibold text-text-primary">Product Description *</label>
              <span className="text-[10px] text-text-muted">{description.length} chars</span>
            </div>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What do you sell? Who is the target demographic? What makes your blade/motor technology special?"
              className={`w-full px-3 py-2 border rounded-lg bg-surface-1 outline-none text-text-primary placeholder-text-muted resize-y focus:border-accent ${
                errors.description ? "border-danger" : "border-border"
              }`}
            />
            {errors.description && <p className="text-[10px] text-danger">{errors.description}</p>}
          </div>
        </div>

        {/* CARD 2: Advanced Context */}
        <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-text-primary">Advanced marketing positioning</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Category */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Market / Amazon Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Hair Clippers & Trimmers"
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              />
            </div>

            {/* Price Point */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Target Price Point</label>
              <input
                type="text"
                value={pricePoint}
                onChange={(e) => setPricePoint(e.target.value)}
                placeholder="e.g. $180"
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Company Context */}
          <div className="space-y-1">
            <label className="font-semibold text-text-primary block">Company Context</label>
            <textarea
              rows={2}
              value={companyContext}
              onChange={(e) => setCompanyContext(e.target.value)}
              placeholder="e.g. Launching under a premium barber sub-brand. We are expanding from styling sprays into hardware tools."
              className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent resize-y"
            />
          </div>
        </div>

        {/* CARD 3: Hardware specs (Precision target) */}
        <div className="bg-surface-2 border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-text-primary">Precision hardware targets</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Motor technology */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Motor technology</label>
              <select
                value={motorTech}
                onChange={(e) => setMotorTech(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              >
                <option value="">Select motor type</option>
                <option value="Brushless DC">Brushless DC (BLDC)</option>
                <option value="Rotary">Rotary motor</option>
                <option value="Magnetic/Pivot">Magnetic / Pivot motor</option>
                <option value="Universal/Corded">Universal corded motor</option>
                <option value="Cordless Li-ion">Cordless / Lithium-ion</option>
              </select>
            </div>

            {/* Key Differentiator */}
            <div className="space-y-1">
              <label className="font-semibold text-text-primary block">Key differentiating feature</label>
              <input
                type="text"
                value={keyDiff}
                onChange={(e) => setKeyDiff(e.target.value)}
                placeholder="e.g. interchangeable body kits, stayed-cool blade"
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-1 text-text-primary outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>

        {/* Action Row */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push("/dashboard/projects")}
            disabled={loading}
            className="px-4 py-2.5 rounded-lg border border-border hover:bg-surface-3 font-semibold text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover font-semibold text-white flex items-center justify-center gap-1.5 transition-all shadow shadow-accent/25"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Creating project...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save project</span>
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}

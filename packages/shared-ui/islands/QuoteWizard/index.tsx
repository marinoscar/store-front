import { useEffect, useMemo, useState } from 'react';
import type { Service } from '@store-front/shared-ui/lib/types';
import {
  calcQuote,
  submitQuote,
  validateAddress,
  type AddressValidateResponse,
  type QuoteCalcResponse,
} from '@store-front/shared-ui/lib/apiClient';
import PhotoDropzone, { type UploadedFile } from '@store-front/shared-ui/islands/PhotoDropzone';

type Step = 'service' | 'photos' | 'address' | 'contact' | 'review' | 'done';

type ResolvedAddress = Extract<AddressValidateResponse, { found: true }>;

interface Props {
  services: Service[];
}

export default function QuoteWizard({ services }: Props) {
  const [step, setStep] = useState<Step>('service');
  const [quoteId, setQuoteId] = useState<string | undefined>();
  const [serviceId, setServiceId] = useState<string>('');
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [addressQuery, setAddressQuery] = useState('');
  const [addressResult, setAddressResult] = useState<ResolvedAddress | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [notes, setNotes] = useState('');
  const [sqft, setSqft] = useState<number | ''>('');
  const [estimate, setEstimate] = useState<QuoteCalcResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');

  // Preselect service if URL has ?service=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('service');
    if (s && services.some((sv) => sv.id === s)) setServiceId(s);
  }, [services]);

  // Compute estimate as the user provides sqft / changes service
  useEffect(() => {
    if (!serviceId) return;
    const inputs: { serviceId: string; sqft?: number } = { serviceId };
    if (typeof sqft === 'number' && sqft > 0) inputs.sqft = sqft;
    calcQuote(inputs)
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [serviceId, sqft]);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId),
    [services, serviceId],
  );

  async function checkAddress() {
    if (addressQuery.trim().length < 4) return;
    setAddressLoading(true);
    try {
      const res = await validateAddress(addressQuery.trim());
      setAddressResult(res.found ? res : null);
    } catch {
      setAddressResult(null);
    } finally {
      setAddressLoading(false);
    }
  }

  async function handleSubmit() {
    if (!selectedService) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const submitBody: Parameters<typeof submitQuote>[0] = {
        quoteId,
        serviceId,
        contact,
        address: addressResult
          ? { formatted: addressResult.address, lat: addressResult.lat, lng: addressResult.lng }
          : { formatted: addressQuery },
        notes: notes || undefined,
        photoKeys: photos.map((p) => p.key),
        honeypot,
      };
      if (estimate) submitBody.estimate = estimate;
      const res = await submitQuote(submitBody);
      setQuoteId(res.quoteId);
      setPdfUrl(res.pdfUrl);
      setStep('done');
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const stepIndex = ['service', 'photos', 'address', 'contact', 'review', 'done'].indexOf(step);
  const totalSteps = 5;
  const canNext = (() => {
    if (step === 'service') return serviceId.length > 0;
    if (step === 'photos') return true; // photos optional
    if (step === 'address') return addressQuery.trim().length > 3;
    if (step === 'contact') return contact.name && /^\S+@\S+\.\S+$/.test(contact.email) && contact.phone.length >= 5;
    return true;
  })();

  function next() {
    const order: Step[] = ['service', 'photos', 'address', 'contact', 'review', 'done'];
    const idx = order.indexOf(step);
    if (idx < order.length - 1) setStep(order[idx + 1]!);
  }
  function back() {
    const order: Step[] = ['service', 'photos', 'address', 'contact', 'review'];
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]!);
  }

  return (
    <div className="wiz">
      {/* Honeypot — must stay empty; bots fill all inputs */}
      <input
        type="text"
        name="company_website"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
      />

      {step !== 'done' && (
        <header className="wiz__header">
          <div className="wiz__progress" aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
            <div className="wiz__bar" style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }} />
          </div>
          <span className="wiz__count">Step {stepIndex + 1} of {totalSteps}</span>
        </header>
      )}

      {step === 'service' && (
        <section>
          <h3>What service do you need?</h3>
          <div className="wiz__service-grid">
            {services.map((s) => (
              <label key={s.id} className={`wiz__service ${serviceId === s.id ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="service"
                  value={s.id}
                  checked={serviceId === s.id}
                  onChange={() => setServiceId(s.id)}
                />
                <img src={s.image} alt="" />
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.shortDescription}</small>
                </div>
              </label>
            ))}
          </div>
          <div className="wiz__field">
            <label htmlFor="sqft">Approximate square footage (optional)</label>
            <input
              id="sqft"
              type="number"
              min={0}
              inputMode="numeric"
              value={sqft}
              onChange={(e) => setSqft(e.target.value ? Number(e.target.value) : '')}
              placeholder="e.g. 500"
            />
          </div>
        </section>
      )}

      {step === 'photos' && (
        <section>
          <h3>Add a few photos of the area</h3>
          <p className="wiz__hint">Helps us prepare an accurate quote. Optional — you can skip this step.</p>
          <PhotoDropzone
            quoteId={quoteId}
            onUploaded={(uploaded, qid) => {
              setQuoteId(qid);
              setPhotos((prev) => [...prev, ...uploaded]);
            }}
          />
        </section>
      )}

      {step === 'address' && (
        <section>
          <h3>Where’s the job?</h3>
          <p className="wiz__hint">We’ll confirm it’s in our service area.</p>
          <div className="wiz__field">
            <label htmlFor="addr">Service address</label>
            <input
              id="addr"
              type="text"
              value={addressQuery}
              onChange={(e) => setAddressQuery(e.target.value)}
              onBlur={checkAddress}
              placeholder="123 Main St, San José"
            />
          </div>
          <button type="button" className="btn btn--ghost" onClick={checkAddress} disabled={addressLoading}>
            {addressLoading ? 'Checking…' : 'Verify address'}
          </button>
          {addressResult && (
            <div className={`wiz__addr ${addressResult.inServiceArea ? 'is-ok' : 'is-warn'}`}>
              <strong>{addressResult.address}</strong>
              <small>
                {addressResult.inServiceArea
                  ? '✓ In our service area'
                  : '⚠ Outside our normal service area — we’ll check feasibility.'}
              </small>
            </div>
          )}
        </section>
      )}

      {step === 'contact' && (
        <section>
          <h3>How can we reach you?</h3>
          <div className="wiz__field">
            <label htmlFor="name">Full name</label>
            <input id="name" type="text" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          </div>
          <div className="wiz__field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" inputMode="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          </div>
          <div className="wiz__field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" type="tel" inputMode="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </div>
          <div className="wiz__field">
            <label htmlFor="notes">Notes (optional)</label>
            <textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else we should know?"
            />
          </div>
        </section>
      )}

      {step === 'review' && (
        <section>
          <h3>Review and submit</h3>
          <dl className="wiz__review">
            <dt>Service</dt>
            <dd>{selectedService?.name}</dd>
            {photos.length > 0 && (<>
              <dt>Photos</dt>
              <dd>{photos.length} uploaded</dd>
            </>)}
            <dt>Address</dt>
            <dd>{addressResult?.address ?? addressQuery}</dd>
            <dt>Name</dt><dd>{contact.name}</dd>
            <dt>Email</dt><dd>{contact.email}</dd>
            <dt>Phone</dt><dd>{contact.phone}</dd>
            {estimate && (<>
              <dt>Estimated range</dt>
              <dd><strong>{estimate.currency} {estimate.low.toLocaleString()} – {estimate.high.toLocaleString()}</strong></dd>
            </>)}
          </dl>
          {submitErr && <p className="wiz__err">{submitErr}</p>}
        </section>
      )}

      {step === 'done' && (
        <section className="wiz__done">
          <h3>Quote sent! 🎉</h3>
          <p>Check your inbox — your PDF quote is on its way. We’ll follow up shortly to confirm scheduling.</p>
          {pdfUrl && <a className="btn btn--accent" href={pdfUrl} target="_blank" rel="noopener">Download PDF</a>}
        </section>
      )}

      {step !== 'done' && (
        <footer className="wiz__footer">
          {stepIndex > 0 ? (
            <button type="button" className="btn btn--ghost" onClick={back}>Back</button>
          ) : (
            <span />
          )}
          {step === 'review' ? (
            <button type="button" className="btn btn--accent" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Send my quote'}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={next} disabled={!canNext}>
              Next
            </button>
          )}
        </footer>
      )}

      <style>{`
        .wiz { display: flex; flex-direction: column; gap: 1rem; min-height: 320px; }
        .wiz__header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
        .wiz__progress { flex: 1; height: 6px; background: var(--color-border); border-radius: 999px; overflow: hidden; }
        .wiz__bar { height: 100%; background: var(--color-primary); transition: width 250ms ease; }
        .wiz__count { font-size: var(--fs-xs); color: var(--color-muted); }
        h3 { font-size: var(--fs-lg); margin-bottom: 0.5rem; }
        .wiz__hint { color: var(--color-muted); font-size: var(--fs-sm); margin-bottom: 1rem; }
        .wiz__field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.75rem; }
        .wiz__field label { font-weight: 600; font-size: var(--fs-sm); }
        .wiz__field input, .wiz__field textarea {
          width: 100%; padding: 0.625rem 0.75rem;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm); background: var(--color-bg);
        }
        .wiz__field input:focus, .wiz__field textarea:focus { outline-color: var(--color-primary); }
        .wiz__service-grid {
          display: grid; gap: 0.625rem;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
          margin-block: 1rem;
        }
        .wiz__service {
          display: grid; grid-template-columns: 64px 1fr; gap: 0.625rem; align-items: center;
          padding: 0.625rem; border: 1.5px solid var(--color-border); border-radius: var(--radius);
          cursor: pointer; transition: border-color var(--motion-fast), background var(--motion-fast);
        }
        .wiz__service.is-selected { border-color: var(--color-primary); background: color-mix(in oklab, var(--color-primary) 6%, transparent); }
        .wiz__service input { position: absolute; opacity: 0; pointer-events: none; }
        .wiz__service img { width: 64px; height: 64px; object-fit: cover; border-radius: var(--radius-sm); }
        .wiz__service strong { display: block; font-size: var(--fs-sm); }
        .wiz__service small { color: var(--color-muted); font-size: var(--fs-xs); }
        .wiz__addr { margin-top: 0.75rem; padding: 0.75rem; border-radius: var(--radius); display: flex; flex-direction: column; gap: 0.25rem; }
        .wiz__addr.is-ok { background: color-mix(in oklab, var(--color-success) 15%, transparent); }
        .wiz__addr.is-warn { background: color-mix(in oklab, var(--color-accent) 22%, transparent); }
        .wiz__review { display: grid; grid-template-columns: max-content 1fr; gap: 0.375rem 1rem; margin-block: 1rem; }
        .wiz__review dt { color: var(--color-muted); font-size: var(--fs-sm); }
        .wiz__review dd { margin: 0; }
        .wiz__err { color: var(--color-danger); margin-top: 0.5rem; }
        .wiz__done { display: flex; flex-direction: column; gap: 1rem; align-items: flex-start; }
        .wiz__footer { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--color-border); }
      `}</style>
    </div>
  );
}

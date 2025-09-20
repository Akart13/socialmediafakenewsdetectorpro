import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link href="/" className="logo">
              🔍 Fact Checker
            </Link>
            <nav className="nav">
              <Link href="/auth" className="btn btn-secondary">
                Sign In
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container">
            <h1>Social Media Fact Checker</h1>
            <p>
              Verify tweets, Instagram posts, and Facebook posts with AI-powered fact checking. 
              Get credibility scores and reliable sources to combat misinformation.
            </p>
            <Link href="/auth" className="btn btn-primary">
              Get Started
            </Link>
          </div>
        </section>

        <div className="container">
          <div className="card">
            <h2 style={{ marginBottom: '1rem', color: '#2d3748' }}>How It Works</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
              <div>
                <h3 style={{ color: '#4a5568', marginBottom: '0.5rem' }}>1. Install Extension</h3>
                <p style={{ color: '#718096', lineHeight: '1.6' }}>
                  Add our Chrome extension to your browser for easy access to fact-checking tools.
                </p>
              </div>
              <div>
                <h3 style={{ color: '#4a5568', marginBottom: '0.5rem' }}>2. Sign In & Check</h3>
                <p style={{ color: '#718096', lineHeight: '1.6' }}>
                  Create your account and start fact-checking posts with 5 free checks per day.
                </p>
              </div>
              <div>
                <h3 style={{ color: '#4a5568', marginBottom: '0.5rem' }}>3. Get Results</h3>
                <p style={{ color: '#718096', lineHeight: '1.6' }}>
                  Receive AI-powered analysis with credibility scores and verified sources.
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: '1rem', color: '#2d3748' }}>Pricing</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
              <div style={{ padding: '1.5rem', border: '2px solid #e2e8f0', borderRadius: '12px' }}>
                <h3 style={{ color: '#2d3748', marginBottom: '0.5rem' }}>Free</h3>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#667eea', marginBottom: '1rem' }}>$0</div>
                <ul style={{ color: '#4a5568', lineHeight: '1.8' }}>
                  <li>5 fact checks per day</li>
                  <li>Basic credibility scores</li>
                  <li>Source verification</li>
                </ul>
              </div>
              <div style={{ padding: '1.5rem', border: '2px solid #667eea', borderRadius: '12px', background: 'linear-gradient(135deg, #667eea10, #764ba210)' }}>
                <h3 style={{ color: '#2d3748', marginBottom: '0.5rem' }}>Pro</h3>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#667eea', marginBottom: '1rem' }}>$9.99/month</div>
                <ul style={{ color: '#4a5568', lineHeight: '1.8' }}>
                  <li>Unlimited fact checks</li>
                  <li>Advanced AI analysis</li>
                  <li>Priority support</li>
                  <li>Detailed source analysis</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

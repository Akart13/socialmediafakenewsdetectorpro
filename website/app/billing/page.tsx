'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebaseClient';
import Link from 'next/link';

interface UserLimits {
  plan: 'free' | 'pro';
  used: number;
  limit: number | null;
  resetsAt: string;
}

function BillingContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userLimits, setUserLimits] = useState<UserLimits | null>(null);
  const [loadingLimits, setLoadingLimits] = useState(true);
  const router = useRouter();

  const fetchUserLimits = async (user: User) => {
    try {
      setLoadingLimits(true);
      const idToken = await user.getIdToken();
      const response = await fetch('/api/me/limits', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      
      if (response.ok) {
        const limits = await response.json();
        console.log('[BILLING PAGE] Received user limits:', limits);
        setUserLimits(limits);
      } else {
        console.error('Failed to fetch user limits');
      }
    } catch (error) {
      console.error('Error fetching user limits:', error);
    } finally {
      setLoadingLimits(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
      
      if (!user) {
        router.push('/auth');
        return;
      } else {
        // Fetch user limits when user is authenticated
        fetchUserLimits(user);
      }
    });


    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="loading"></div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to auth page
  }

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
                Account
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main>
        <div className="container">
          <div className="card" style={{ maxWidth: '600px', margin: '2rem auto' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '2rem', color: '#2d3748' }}>
              Your Plan
            </h1>

            <div className="user-info" style={{ marginBottom: '2rem', justifyContent: 'center' }}>
              <div className="user-avatar">
                {user.displayName?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: '600', color: '#2d3748' }}>
                  {user.displayName || 'User'}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#718096' }}>
                  {user.email}
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              {loadingLimits ? (
                <div>
                  <h2 style={{ color: '#4a5568', marginBottom: '1rem' }}>Loading...</h2>
                  <p style={{ color: '#718096', marginBottom: '2rem' }}>
                    Fetching your plan information...
                  </p>
                </div>
              ) : (
                <div>
                  <h2 style={{ color: '#4a5568', marginBottom: '1rem' }}>Current Plan: Pro</h2>
                  <p style={{ color: '#718096', marginBottom: '2rem' }}>
                    You have unlimited access to all features.
                  </p>
                </div>
              )}
            </div>

            <div style={{ 
              padding: '1.5rem', 
              border: '2px solid #48bb78', 
              borderRadius: '12px', 
              background: 'linear-gradient(135deg, #48bb7810, #38a16910)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ color: '#2d3748', marginBottom: '0.5rem', textAlign: 'center' }}>Pro Plan</h3>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#667eea', marginBottom: '1rem', textAlign: 'center' }}>Free</div>
              <ul style={{ color: '#4a5568', lineHeight: '1.8', marginBottom: '1rem' }}>
                <li>Unlimited fact checks</li>
                <li>Advanced AI analysis</li>
                <li>Priority support</li>
                <li>Detailed source analysis</li>
                <li>Export fact-check reports</li>
              </ul>
              <div style={{ 
                padding: '0.75rem', 
                background: '#48bb78', 
                borderRadius: '8px',
                fontSize: '0.875rem',
                color: 'white',
                textAlign: 'center',
                fontWeight: '600'
              }}>
                Active Plan
              </div>
            </div>

            <div style={{ 
              padding: '1rem', 
              background: '#f7fafc', 
              borderRadius: '8px',
              fontSize: '0.875rem',
              color: '#4a5568',
              textAlign: 'center'
            }}>
              <strong>Need help?</strong> Contact us at support@factchecker.com
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BillingContent />
    </Suspense>
  );
}

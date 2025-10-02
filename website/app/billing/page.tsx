'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [userLimits, setUserLimits] = useState<UserLimits | null>(null);
  const [loadingLimits, setLoadingLimits] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();

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

    // Check for success/cancel messages from Stripe
    const success = searchParams.get('success');
    const canceled = searchParams.get('canceled');
    const redirectUri = searchParams.get('redirect_uri');
    
    if (success) {
      if (redirectUri) {
        // If this is from an extension, redirect back with success token
        const redirectUrl = new URL(redirectUri);
        redirectUrl.hash = 'payment=success';
        window.location.replace(redirectUrl.toString());
        return;
      } else {
        setMessage({ type: 'success', text: 'Payment successful! You now have Pro access.' });
      }
    } else if (canceled) {
      if (redirectUri) {
        // If this is from an extension, redirect back with cancel token
        const redirectUrl = new URL(redirectUri);
        redirectUrl.hash = 'payment=canceled';
        window.location.replace(redirectUrl.toString());
        return;
      } else {
        setMessage({ type: 'error', text: 'Payment was canceled.' });
      }
    }

    return () => unsubscribe();
  }, [router, searchParams]);

  const handleUpgrade = async () => {
    if (!user) return;

    try {
      setCreatingCheckout(true);
      
      // Get ID token for API authentication
      const idToken = await user.getIdToken();
      
      // Get redirect_uri from URL params if present
      const redirectUri = searchParams.get('redirect_uri');
      
      const response = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ redirect_uri: redirectUri })
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const { url } = await response.json();
      
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
      setMessage({ type: 'error', text: 'Failed to start checkout process. Please try again.' });
    } finally {
      setCreatingCheckout(false);
    }
  };

  const handleDowngrade = async () => {
    if (!user) return;

    try {
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/billing/downgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to downgrade plan');
      }

      setMessage({ type: 'success', text: 'Successfully downgraded to Free plan.' });
      // Refresh user limits
      await fetchUserLimits(user);
    } catch (error) {
      console.error('Error downgrading plan:', error);
      setMessage({ type: 'error', text: 'Failed to downgrade plan. Please try again.' });
    }
  };

  const handleManageSubscription = async () => {
    if (!user) return;

    try {
      const idToken = await user.getIdToken();
      
      // Get redirect_uri from URL params if present
      const redirectUri = searchParams.get('redirect_uri');
      
      const response = await fetch('/api/billing/customer-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ redirect_uri: redirectUri })
      });

      if (!response.ok) {
        throw new Error('Failed to open customer portal');
      }

      const { url } = await response.json();
      
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Error opening customer portal:', error);
      setMessage({ type: 'error', text: 'Failed to open subscription management. Please try again.' });
    }
  };

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
              Billing & Subscription
            </h1>

            {message && (
              <div className={`status ${message.type}`} style={{ marginBottom: '2rem' }}>
                {message.text}
              </div>
            )}

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
              ) : userLimits ? (
                <div>
                  <h2 style={{ color: '#4a5568', marginBottom: '1rem' }}>
                    Current Plan: {userLimits.plan === 'pro' ? 'Pro' : 'Free'}
                  </h2>
                  <p style={{ color: '#718096', marginBottom: '2rem' }}>
                    {userLimits.plan === 'pro' 
                      ? 'You get unlimited access.' 
                      : `You get ${userLimits.limit} fact checks per day. Upgrade to Pro for unlimited access.`
                    }
                  </p>
                </div>
              ) : (
                <div>
                  <h2 style={{ color: '#4a5568', marginBottom: '1rem' }}>Current Plan: Free</h2>
                  <p style={{ color: '#718096', marginBottom: '2rem' }}>
                    You get 5 fact checks per day. Upgrade to Pro for unlimited access.
                  </p>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: '2rem', marginBottom: '2rem' }}>
              <div style={{ 
                padding: '1.5rem', 
                border: userLimits?.plan === 'free' ? '2px solid #48bb78' : '2px solid #e2e8f0', 
                borderRadius: '12px',
                background: userLimits?.plan === 'free' ? '#f0fff4' : 'transparent'
              }}>
                <h3 style={{ color: '#2d3748', marginBottom: '0.5rem' }}>Free Plan</h3>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#4a5568', marginBottom: '1rem' }}>$0</div>
                <ul style={{ color: '#4a5568', lineHeight: '1.8', marginBottom: '1rem' }}>
                  <li>5 fact checks per day</li>
                  <li>Basic credibility scores</li>
                  <li>Source verification</li>
                </ul>
                {userLimits?.plan === 'free' ? (
                  <div style={{ 
                    padding: '0.75rem', 
                    background: '#48bb78', 
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    color: 'white',
                    textAlign: 'center',
                    fontWeight: '600'
                  }}>
                    Current Plan
                  </div>
                ) : (
                  <div style={{ 
                    padding: '0.75rem', 
                    background: '#f7fafc', 
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    color: '#4a5568',
                    textAlign: 'center'
                  }}>
                    Downgrade to Free
                  </div>
                )}
              </div>

              <div style={{ 
                padding: '1.5rem', 
                border: userLimits?.plan === 'pro' ? '2px solid #48bb78' : '2px solid #667eea', 
                borderRadius: '12px', 
                background: userLimits?.plan === 'pro' 
                  ? 'linear-gradient(135deg, #48bb7810, #38a16910)' 
                  : 'linear-gradient(135deg, #667eea10, #764ba210)',
                position: 'relative'
              }}>
                {userLimits?.plan !== 'pro' && (
                  <div style={{
                    position: 'absolute',
                    top: '-10px',
                    right: '20px',
                    background: '#667eea',
                    color: 'white',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: '600'
                  }}>
                    RECOMMENDED
                  </div>
                )}
                <h3 style={{ color: '#2d3748', marginBottom: '0.5rem' }}>Pro Plan</h3>
                <div style={{ fontSize: '2rem', fontWeight: '700', color: '#667eea', marginBottom: '1rem' }}>$9.99/month</div>
                <ul style={{ color: '#4a5568', lineHeight: '1.8', marginBottom: '1rem' }}>
                  <li>Unlimited fact checks</li>
                  <li>Advanced AI analysis</li>
                  <li>Priority support</li>
                  <li>Detailed source analysis</li>
                  <li>Export fact-check reports</li>
                </ul>
                {userLimits?.plan === 'pro' ? (
                  <div>
                    <div style={{ 
                      padding: '0.75rem', 
                      background: '#48bb78', 
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                      color: 'white',
                      textAlign: 'center',
                      fontWeight: '600',
                      marginBottom: '1rem'
                    }}>
                      Current Plan
                    </div>
                    <button 
                      onClick={handleManageSubscription}
                      className="btn btn-secondary"
                      style={{ width: '100%', marginBottom: '1rem' }}
                    >
                      Manage Subscription
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={handleUpgrade}
                    disabled={creatingCheckout}
                    className="btn btn-primary"
                    style={{ width: '100%', marginBottom: '1rem' }}
                  >
                    {creatingCheckout ? (
                      <>
                        <span className="loading" style={{ marginRight: '0.5rem' }}></span>
                        Processing...
                      </>
                    ) : (
                      'Upgrade to Pro'
                    )}
                  </button>
                )}
                {userLimits?.plan === 'pro' && (
                  <button 
                    onClick={handleDowngrade}
                    className="btn btn-secondary"
                    style={{ width: '100%' }}
                  >
                    Downgrade to Free
                  </button>
                )}
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

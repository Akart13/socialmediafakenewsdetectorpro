'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebaseClient';
import Link from 'next/link';

export default function AuthPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setLoading(false);
      
      // Register user in Firebase immediately after sign-up
      if (user && typeof window !== 'undefined') {
        console.log('User signed in, attempting to register in Firestore:', user.uid, user.email);
        try {
          const idToken = await user.getIdToken();
          console.log('Got ID token, calling registration API...');
          
          const registerResponse = await fetch('/api/users/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            }
          });
          
          if (registerResponse.ok) {
            const result = await registerResponse.json();
            console.log('User registration successful:', result);
          } else {
            const errorText = await registerResponse.text();
            console.error('Failed to register user in Firebase:', registerResponse.status, errorText);
          }
        } catch (error) {
          console.error('Error registering user:', error);
        }

        const urlParams = new URLSearchParams(window.location.search);
        const state = urlParams.get('state');
        const source = urlParams.get('source');
        
        if (source === 'extension') {
          // This is an extension login, use the new finalize endpoint
          try {
            const idToken = await user.getIdToken();
            const response = await fetch('/api/auth/finalize', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
              },
              credentials: 'include' // Important for setting refresh cookie
            });
            
            if (response.ok) {
              const { access } = await response.json();
              
              // Redirect back to extension with token
              const redirectUrl = new URL(window.location.href);
              redirectUrl.searchParams.set('token', access);
              window.location.replace(redirectUrl.toString());
            } else {
              throw new Error('Failed to finalize authentication');
            }
          } catch (error) {
            console.error('Extension auth error:', error);
            setMessage({ type: 'error', text: 'Authentication failed. Please try again.' });
          }
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setSigningIn(true);
      await signInWithPopup(auth, googleProvider);
      // User will be automatically updated via onAuthStateChanged
    } catch (error) {
      console.error('Sign in error:', error);
      alert('Sign in failed. Please try again.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="loading"></div>
      </div>
    );
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
              <Link href="/" className="btn btn-secondary">
                Home
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main>
        <div className="container">
          <div className="card" style={{ maxWidth: '500px', margin: '4rem auto' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '2rem', color: '#2d3748' }}>
              {user ? 'Account' : 'Sign In'}
            </h1>

            {user ? (
              <div>
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

                <div style={{ textAlign: 'center' }}>
                  <Link href="/billing" className="btn btn-primary" style={{ marginBottom: '1rem', display: 'block' }}>
                    Manage Billing
                  </Link>
                  <button onClick={handleSignOut} className="btn btn-secondary">
                    Sign Out
                  </button>
                </div>

                <div style={{ marginTop: '2rem', padding: '1rem', background: '#f7fafc', borderRadius: '8px' }}>
                  <h3 style={{ color: '#4a5568', marginBottom: '0.5rem' }}>Next Steps</h3>
                  <p style={{ color: '#718096', fontSize: '0.875rem', lineHeight: '1.6' }}>
                    1. Install the Chrome extension<br/>
                    2. Sign in through the extension<br/>
                    3. Start fact-checking social media posts
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: '#4a5568', marginBottom: '2rem', lineHeight: '1.6' }}>
                  Sign in with Google to access your account and manage your subscription.
                </p>
                
                <button 
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                >
                  {signingIn ? (
                    <>
                      <span className="loading" style={{ marginRight: '0.5rem' }}></span>
                      Signing in...
                    </>
                  ) : (
                    <>
                      <span style={{ marginRight: '0.5rem' }}>🔐</span>
                      Sign in with Google
                    </>
                  )}
                </button>

                <div style={{ marginTop: '2rem', padding: '1rem', background: '#f7fafc', borderRadius: '8px' }}>
                  <h3 style={{ color: '#4a5568', marginBottom: '0.5rem' }}>Why Sign In?</h3>
                  <ul style={{ color: '#718096', fontSize: '0.875rem', lineHeight: '1.6', textAlign: 'left' }}>
                    <li>Track your daily fact-check usage</li>
                    <li>Upgrade to Pro for unlimited checks</li>
                    <li>Manage your subscription</li>
                    <li>Access your fact-check history</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebaseClient';
import Link from 'next/link';

/**
 * Login form component that handles user authentication via Google Sign-In.
 * Manages authentication state, registration, and session creation.
 * Handles extension login flow and redirects appropriately.
 * 
 * @returns {JSX.Element} The login form component
 */
function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; delay: number }>>([]);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Generate floating particles
  useEffect(() => {
    const generateParticles = () => {
      const newParticles = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: Math.random() * 3
      }));
      setParticles(newParticles);
    };
    
    generateParticles();
    setIsVisible(true);
  }, []);

  /**
   * Effect hook that listens for Firebase authentication state changes.
   * When user signs in, registers them in Firestore and creates a session cookie.
   * Handles extension login flow and redirects appropriately.
   */
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // User is signed in, register user and create session cookie
        try {
          const idToken = await user.getIdToken();
          
          // First, register the user in Firestore
          console.log('User signed in, attempting to register in Firestore:', user.uid, user.email);
          try {
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
          } catch (registerError) {
            console.error('Error registering user:', registerError);
          }

          // Then create session cookie
          const response = await fetch('/api/auth/session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ idToken }),
            credentials: 'include'
          });

          if (response.ok) {
            setMessage({ type: 'success', text: 'Successfully signed in!' });
            
            // Check if this came from extension
            const fromExtension = searchParams.get('from') === 'extension';
            const redirectUri = searchParams.get('redirect_uri');
            
            if (fromExtension) {
              // Close the tab after a short delay for extension users
              setTimeout(() => {
                window.close();
              }, 2000);
            } else if (redirectUri) {
              // Redirect to specified URI
              window.location.href = redirectUri;
            } else {
              // Default redirect to dashboard
              router.push('/');
            }
          } else {
            setMessage({ type: 'error', text: 'Failed to create session. Please try again.' });
          }
        } catch (error) {
          console.error('Error creating session:', error);
          setMessage({ type: 'error', text: 'An error occurred. Please try again.' });
        }
      }
    });

    return () => unsubscribe();
  }, [router, searchParams]);

  /**
   * Handles Google Sign-In button click by initiating Firebase authentication popup.
   * Updates loading state and handles errors appropriately.
   */
  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      setMessage(null);
      
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Sign-in error:', error);
      setMessage({ 
        type: 'error', 
        text: error.code === 'auth/popup-closed-by-user' 
          ? 'Sign-in was cancelled' 
          : 'Failed to sign in. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

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
              Sign In
            </h1>

            {/* Message Display */}
            {message && (
              <div className={`mb-6 p-4 rounded-lg ${
                message.type === 'success' 
                  ? 'bg-green-50 text-green-800 border border-green-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                <div className="flex items-center">
                  {message.type === 'success' ? (
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  )}
                  {message.text}
                </div>
              </div>
            )}

            <div style={{ textAlign: 'center' }}>
              <p style={{ color: '#4a5568', marginBottom: '2rem', lineHeight: '1.6' }}>
                Sign in with Google to access your account and manage your subscription.
              </p>
              
              <button 
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                {loading ? (
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
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Main login page component wrapped in Suspense for Next.js dynamic imports.
 * 
 * @returns {JSX.Element} The login page with Suspense wrapper
 */
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div className="loading"></div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

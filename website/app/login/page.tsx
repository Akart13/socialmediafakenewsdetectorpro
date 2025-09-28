'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebaseClient';

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
    <div className="min-h-screen bg-gradient-to-br from-blue-400 via-purple-500 to-purple-600 flex items-center justify-center p-4">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6">
        <div className="flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center space-x-2">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-white font-bold text-xl">Fact Checker</span>
          </div>
          
          {/* Home Button */}
          <button className="bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 rounded-lg px-4 py-2 text-white font-medium transition-all duration-200">
            Home
          </button>
        </div>
      </div>

      {/* Main Login Card */}
      <div className={`w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 transition-all duration-1000 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
      }`}>
        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-800 text-center mb-2">Sign In</h1>
        
        {/* Description */}
        <p className="text-gray-600 text-center mb-8">
          Sign in with Google to access your account and manage your subscription.
        </p>

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

        {/* Google Sign In Button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center px-6 py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 active:scale-95"
        >
          {loading ? (
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-3"></div>
              <span>Signing in...</span>
            </div>
          ) : (
            <div className="flex items-center">
              {/* Lock Icon */}
              <svg className="w-5 h-5 mr-3 text-yellow-300" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span>Sign in with Google</span>
            </div>
          )}
        </button>

        {/* Divider */}
        <div className="my-8 border-t border-gray-200"></div>

        {/* Why Sign In Section */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Why Sign In?</h2>
          <ul className="space-y-3">
            <li className="flex items-start">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              <span className="text-gray-700">Track your daily fact-check usage</span>
            </li>
            <li className="flex items-start">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              <span className="text-gray-700">Upgrade to Pro for unlimited checks</span>
            </li>
            <li className="flex items-start">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              <span className="text-gray-700">Manage your subscription</span>
            </li>
            <li className="flex items-start">
              <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
              <span className="text-gray-700">Access your fact-check history</span>
            </li>
          </ul>
        </div>

        {/* Terms and Privacy */}
        <div className="text-center">
          <p className="text-sm text-gray-600">
            By signing in, you agree to our{' '}
            <a href="/terms" className="text-purple-600 hover:text-purple-700 underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy" className="text-purple-600 hover:text-purple-700 underline">
              Privacy Policy
            </a>
          </p>
        </div>

        {/* Extension Notice */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            This page will close automatically after successful sign-in
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-400 via-purple-500 to-purple-600 flex items-center justify-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-2 border-purple-600 border-t-transparent mb-4"></div>
            <p className="text-gray-600 text-lg">Loading...</p>
          </div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

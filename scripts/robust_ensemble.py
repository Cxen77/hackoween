"""Convex minimax ensemble of validation errors; no test targets are inputs."""
import numpy as np
from scipy.optimize import minimize


def minimax_weights(covariances, initial):
    """Minimize the worst incumbent-relative MSE across validation objectives.

    Covariance matrices must already be divided by the incumbent MSE. Weights
    remain nonnegative and sum to one, so predictions remain a convex blend.
    """
    matrices=np.asarray(covariances,dtype=float)
    initial=np.asarray(initial,dtype=float)
    if matrices.ndim!=3 or matrices.shape[1:]!=(len(initial),len(initial)):
        raise ValueError('Expected square covariance matrices matching component count')
    if not np.isfinite(matrices).all() or (initial<0).any() or not np.isclose(initial.sum(),1):
        raise ValueError('Invalid covariance or initial weights')
    start=np.r_[initial,max(initial@c@initial for c in matrices)]
    constraints=[{'type':'eq','fun':lambda z:z[:-1].sum()-1,
                  'jac':lambda z:np.r_[np.ones(len(initial)),0.]}]
    for matrix in matrices:
        constraints.append({'type':'ineq','fun':lambda z,c=matrix:z[-1]-z[:-1]@c@z[:-1],
                            'jac':lambda z,c=matrix:np.r_[-2*c@z[:-1],1.]})
    result=minimize(lambda z:z[-1],start,jac=lambda z:np.r_[np.zeros(len(initial)),1.],
                    bounds=[(0.,1.)]*len(initial)+[(0.,None)],constraints=constraints,
                    method='SLSQP',options={'maxiter':500,'ftol':1e-12})
    weights=np.maximum(result.x[:-1],0);weights/=weights.sum()
    worst=max(weights@c@weights for c in matrices)
    return weights,{'success':bool(result.success),'message':str(result.message),
                    'worst_relative_mse':float(worst),'iterations':int(result.nit)}
